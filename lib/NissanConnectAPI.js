'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const { NissanConnectError, ErrorTypes } = require('./errors');
const { 
  TemperatureLimits, 
  clampTemperature,
  ActionStatus,
  isActionComplete,
  isActionFailed,
  PollingConfig
} = require('./constants');
const {
  mapKamereonBatteryStatus,
  mapKamereonHvacStatus,
  mapKamereonCockpit,
  mapKamereonLocation
} = require('./mappers');

const NISSAN_API_SETTINGS = {
  EU: {
    client_id: 'a-ncb-nc-android-prod',
    client_secret: '6GKIax7fGT5yPHuNmWNVOc4q5POBw1WRSW39ubRA8WPBmQ7MOxhm75EsmKMKENem',
    scope: 'openid profile vehicles',
    auth_base_url: 'https://prod.eu2.auth.kamereon.org/kauth/',
    realm: 'a-ncb-prod',
    redirect_uri: 'org.kamereon.service.nci:/oauth2redirect',
    car_adapter_base_url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/',
    user_adapter_base_url: 'https://alliance-platform-usersadapter-prod.apps.eu2.kamereon.io/user-adapter/',
    user_base_url: 'https://nci-bff-web-prod.apps.eu2.kamereon.io/bff-web/'
  }
};

const API_VERSION = 'protocol=1.0,resource=2.1';

class NissanLeafAPI {
  constructor(username, password, vin = null) {
    this.username = username;
    this.password = password;
    this.fallbackVin = vin;
    this.session = null;
    this._authPromise = null; // Mutex for concurrent auth requests
    this._refreshCallback = null; // Callback for when background refresh completes
    this._climateCallback = null; // Callback for when climate command completes
    this._isRefreshing = false; // Track if refresh is in progress
    
    // Setup cookie jar for authentication
    this.jar = new CookieJar();
    this.amClient = wrapper(axios.create({ 
      jar: this.jar, 
      withCredentials: true, 
      validateStatus: s => s >= 200 && s < 400 
    }));
  }

  /**
   * Set a callback function to be called when background refresh completes
   * @param {Function} callback - Function(success, data) to call when refresh completes
   */
  setRefreshCallback(callback) {
    this._refreshCallback = callback;
  }

  /**
   * Check if a refresh operation is currently in progress
   */
  isRefreshing() {
    return this._isRefreshing;
  }

  /**
   * Set a callback function to be called when climate command completes
   * @param {Function} callback - Function(success, action) where action is 'start' or 'stop'
   */
  setClimateCallback(callback) {
    this._climateCallback = callback;
  }

  // Helper functions
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _b64url(str) {
    return str
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  _randomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomValues);
    } else {
      for (let i = 0; i < length; i++) {
        randomValues[i] = Math.floor(Math.random() * 256);
      }
    }
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    return result;
  }

  _sha256(str) {
    // Use Node.js crypto module for secure SHA-256 hashing
    const hash = crypto.createHash('sha256').update(str).digest('base64');
    return this._b64url(hash);
  }

  _makePkce() {
    const verifier = this._randomString(128);
    const challenge = this._sha256(verifier);
    return { verifier, challenge };
  }

  _nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  _needsNewToken() {
    if (!this.session) return true;
    const { expiresAt } = this.session;
    return !expiresAt || (this._nowSec() + 60) >= expiresAt;
  }

  async getSession(force = false) {
    // If auth is already in progress, wait for it (mutex pattern)
    if (this._authPromise) {
      return this._authPromise;
    }

    // Return cached session if still valid
    if (!force && !this._needsNewToken()) {
      return this.session;
    }

    // Start new auth flow with mutex
    this._authPromise = this._performAuth();
    
    try {
      return await this._authPromise;
    } finally {
      this._authPromise = null;
    }
  }

  async _performAuth() {
    const settings = NISSAN_API_SETTINGS.EU;
    if (!this.username || !this.password) {
      throw new NissanConnectError({
        name: ErrorTypes.NOT_LOGGED_IN,
        message: 'Missing username/password'
      });
    }

    const AM_AUTH_URL = 'https://prod.eu2.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate';
    const AM_BASE_HEADERS = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Api-Version': API_VERSION,
      'X-Username': 'anonymous',
      'X-Password': 'anonymous'
    };

    // 1) AM start: get authId + callbacks
    const startRes = await this.amClient.post(AM_AUTH_URL, {}, { headers: AM_BASE_HEADERS });
    const start = startRes.data;
    if (!start?.authId || !Array.isArray(start?.callbacks)) {
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'Unexpected AM start payload',
        cause: start
      });
    }

    // 2) Fill callbacks with username/password
    const filled = {
      authId: start.authId,
      callbacks: start.callbacks.map((cb) => {
        if (cb?.type === 'NameCallback' && cb.input?.[0]) {
          cb.input[0].value = this.username;
        }
        if (cb?.type === 'PasswordCallback' && cb.input?.[0]) {
          cb.input[0].value = this.password;
        }
        return cb;
      })
    };

    // 3) Complete LDAP1
    const finishRes = await this.amClient.post(AM_AUTH_URL, filled, { headers: AM_BASE_HEADERS });
    const finish = finishRes.data;
    let hasSession = !!finish?.tokenId;
    
    if (!hasSession) {
      try {
        const cookies = await this.jar.getCookies('https://prod.eu2.auth.kamereon.org/kauth');
        hasSession = cookies.some((c) => /iPlanetDirectoryPro/i.test(c.key));
      } catch (e) {
        // Ignore
      }
    }
    
    if (!hasSession) {
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'AM auth did not establish a session',
        cause: finish
      });
    }

    // 4) OAuth2 authorize (code + PKCE)
    const { verifier, challenge } = this._makePkce();
    const nonce = this._randomString(22);
    const state = this._randomString(22);

    const authorizeURL = `${settings.auth_base_url}oauth2/realms/root/realms/${settings.realm}/authorize`;
    const authParams = {
      client_id: settings.client_id,
      redirect_uri: settings.redirect_uri,
      response_type: 'code',
      scope: settings.scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce
    };

    const authRes = await this.amClient.get(authorizeURL, {
      headers: { Accept: 'application/json' },
      params: authParams,
      maxRedirects: 0,
      validateStatus: s => (s === 302 || (s >= 200 && s < 300))
    });

    const loc = authRes.headers?.location;
    if (!loc || !/code=/.test(loc)) {
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'Authorize did not return code',
        cause: loc || 'N/A'
      });
    }
    
    const code = new URL(loc, 'https://dummy').searchParams.get('code');
    if (!code) {
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'Missing authorization code'
      });
    }

    // 5) Exchange code for access token
    const tokenURL = `${settings.auth_base_url}oauth2/realms/root/realms/${settings.realm}/access_token`;
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: settings.redirect_uri,
      client_id: settings.client_id,
      code_verifier: verifier,
      client_secret: settings.client_secret
    });

    const tokenRes = await this.amClient.post(tokenURL, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, expires_in } = tokenRes.data || {};
    if (!access_token) {
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'Token exchange failed',
        cause: tokenRes.data
      });
    }
    
    const bearerToken = access_token;
    const expiresAt = this._nowSec() + (typeof expires_in === 'number' ? expires_in : 3600);

    // 6) Discover VIN from BFF API using KID from id_token
    let vin = this.fallbackVin;
    try {
      // Parse id_token to extract KID (user identifier)
      const idToken = tokenRes.data.id_token;
      if (idToken) {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const kid = payload.KID;
        
        if (kid) {
          // Use BFF API to get vehicles list
          const carsUrl = `${settings.user_base_url}v5/users/${kid}/cars`;
          const carsRes = await axios.get(carsUrl, {
            headers: { Authorization: `Bearer ${bearerToken}` }
          });
          
          const cars = carsRes.data?.data || [];
          if (Array.isArray(cars) && cars.length > 0 && cars[0].vin) {
            vin = cars[0].vin;
          }
        }
      }
    } catch (e) {
      console.log('VIN discovery failed, using fallback:', e.message);
    }
    
    if (!vin) {
      throw new NissanConnectError({
        name: ErrorTypes.VEHICLE_UNAVAILABLE,
        message: 'Could not determine VIN'
      });
    }

    // 7) Cache and return
    this.session = { bearerToken, vin, expiresAt };
    return this.session;
  }

  async _requestWithRetry(endpoint, method = 'POST', additionalHeaders = {}, params = {}, options = {}) {
    const session = await this.getSession();
    const timeout = options.timeout || 60000; // Increased from 15s to 60s for slow Nissan API

    let headers = {
      Authorization: `Bearer ${session.bearerToken}`,
      Accept: 'application/vnd.api+json',
      ...additionalHeaders
    };

    const doReq = () =>
      method === 'GET'
        ? axios.get(endpoint, { headers, params, timeout })
        : axios.post(endpoint, params, { headers, timeout });

    try {
      return await doReq();
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('[NissanLeafAPI] Token expired. Re-authenticating and retrying.');
        const fresh = await this.getSession(true);
        headers.Authorization = `Bearer ${fresh.bearerToken}`;
        return await doReq();
      }
      throw error;
    }
  }

  async _refreshBattery(vin, options = {}) {
    const settings = NISSAN_API_SETTINGS.EU;
    const pollOptions = {
      attempts: options.attempts || 15,
      intervalMs: options.intervalMs || 6000
    };
    
    console.log('[NissanLeafAPI] Requesting battery refresh...');
    
    const resp = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${vin}/actions/refresh-battery-status`,
      'POST',
      { 'Content-Type': 'application/vnd.api+json' },
      { data: { type: 'RefreshBatteryStatus' } },
      { timeout: 60000 }
    );
    
    const actionId = resp.data?.data?.id;
    if (!actionId) {
      console.log('[NissanLeafAPI] No actionId from refresh-battery-status');
      throw new NissanConnectError({
        name: ErrorTypes.BATTERY_STATUS_UNAVAILABLE,
        message: 'No actionId from refresh-battery-status'
      });
    }
    
    console.log(`[NissanLeafAPI] Battery refresh actionId: ${actionId}`);
    return await this._actionIsCompletedPoll(actionId, vin, pollOptions);
  }

  /**
   * Background battery refresh with retries
   * Fire-and-forget: starts refresh in background, retries up to 10 times
   * Calls the refresh callback when complete
   */
  async _backgroundRefreshBattery(vin) {
    const maxRetries = 10;
    const retryInterval = 10000; // 10 seconds between retry attempts
    
    if (this._isRefreshing) {
      console.log('[NissanLeafAPI] Background refresh already in progress, skipping');
      return false;
    }
    
    this._isRefreshing = true;
    console.log(`[NissanLeafAPI] Starting background battery refresh (max ${maxRetries} retries)`);
    
    try {
      for (let i = 0; i < maxRetries; i++) {
        try {
          console.log(`[NissanLeafAPI] Background refresh attempt ${i + 1}/${maxRetries}`);
          
          const success = await this._refreshBattery(vin, {
            attempts: 15,
            intervalMs: 6000
          });
          
          if (success) {
            console.log('[NissanLeafAPI] Background battery refresh completed successfully');
            
            // Fetch updated battery status
            const batteryData = await this.getBatteryStatus({ skipRefresh: true });
            
            // Call the callback if set
            if (this._refreshCallback) {
              this._refreshCallback(true, batteryData);
            }
            
            return true;
          }
          
          console.log(`[NissanLeafAPI] Refresh attempt ${i + 1} did not complete, will retry`);
          
        } catch (e) {
          console.log(`[NissanLeafAPI] Background refresh attempt ${i + 1} failed: ${e.message}`);
        }
        
        if (i < maxRetries - 1) {
          console.log(`[NissanLeafAPI] Waiting ${retryInterval / 1000}s before next retry...`);
          await this._sleep(retryInterval);
        }
      }
      
      console.log('[NissanLeafAPI] Background battery refresh gave up after all retries');
      
      if (this._refreshCallback) {
        this._refreshCallback(false, null);
      }
      
      return false;
      
    } finally {
      this._isRefreshing = false;
    }
  }

  /**
   * Start a background refresh (fire-and-forget)
   * Returns immediately, refresh happens in background
   */
  async startBackgroundRefresh() {
    const session = await this.getSession();
    
    // Fire and forget - don't await
    this._backgroundRefreshBattery(session.vin).catch(e => {
      console.log('[NissanLeafAPI] Background refresh error (ignored):', e.message);
      this._isRefreshing = false;
    });
    
    return true;
  }

  /**
   * Background polling for climate action (fire-and-forget)
   * Polls for action completion and calls callback with result
   * @param {string} actionId - The action ID to poll
   * @param {string} vin - Vehicle VIN
   * @param {string} action - 'start' or 'stop'
   */
  _pollClimateAction(actionId, vin, action) {
    // Fire and forget - don't await, don't block
    (async () => {
      try {
        console.log(`[NissanLeafAPI] Background polling for HVAC ${action}...`);
        
        // Reduced timeout: 10 attempts x 6s = 60s (instead of 25 x 6s = 150s)
        const success = await this._actionIsCompletedPoll(actionId, vin, {
          attempts: 10,
          intervalMs: 6000
        });
        
        console.log(`[NissanLeafAPI] HVAC ${action} polling result: ${success ? 'success' : 'failure'}`);
        
        if (this._climateCallback) {
          this._climateCallback(success, action);
        }
      } catch (e) {
        console.log(`[NissanLeafAPI] HVAC ${action} polling error: ${e.message}`);
        // On error, assume success since command was accepted
        // Don't revert the optimistic UI update
        if (this._climateCallback) {
          this._climateCallback(true, action);
        }
      }
    })();
  }

  async _actionIsCompletedPoll(actionId, vin, options = {}) {
    const settings = NISSAN_API_SETTINGS.EU;
    const attempts = options.attempts || 20; // Increased from 6 to 20 (2 min total)
    const intervalMs = options.intervalMs || 6000; // Increased from 5s to 6s
    
    console.log(`[NissanLeafAPI] Starting action poll for ${actionId}, max ${attempts} attempts`);
    
    for (let i = 0; i < attempts; i++) {
      try {
        const resp = await this._requestWithRetry(
          `${settings.car_adapter_base_url}v1/cars/${vin}/actions/status?actionId=${actionId}`,
          'GET'
        );
        
        const status = resp.data?.data?.attributes?.status || '';
        console.log(`[NissanLeafAPI] Poll ${i + 1}/${attempts}, status: ${status || 'unknown'}`);
        
        // Success statuses (COMPLETED, SUCCESS, DONE)
        if (isActionComplete(status)) {
          console.log(`[NissanLeafAPI] Action completed successfully`);
          return true;
        }
        
        // Failure statuses (FAILED, ERROR, CANCELLED, ABORTED, REJECTED) - stop polling immediately
        if (isActionFailed(status)) {
          console.log(`[NissanLeafAPI] Action failed with status: ${status}`);
          return false;
        }
        
        // Pending statuses - continue polling (PENDING, IN_PROGRESS, STARTED, QUEUED, PRISTINE, etc.)
      } catch (e) {
        console.log(`[NissanLeafAPI] Poll ${i + 1}/${attempts} error: ${e.message}`);
      }
      
      await this._sleep(intervalMs);
    }
    
    console.log(`[NissanLeafAPI] Polling timed out after ${attempts} attempts (${Math.round(attempts * intervalMs / 1000)}s)`);
    return false;
  }

  async getBatteryStatus(options = {}) {
    const session = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;
    const skipRefresh = options.skipRefresh || false;

    // Unless skipRefresh is set, try a blocking refresh (for backwards compatibility)
    // For non-blocking refresh, use startBackgroundRefresh() instead
    if (!skipRefresh) {
      try {
        console.log('[NissanLeafAPI] Attempting battery refresh before status fetch...');
        await this._refreshBattery(session.vin);
      } catch (e) {
        console.log('[NissanLeafAPI] Battery refresh failed, will use cached data:', e.message);
      }
    }

    console.log('[NissanLeafAPI] Fetching battery status...');
    const response = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${session.vin}/battery-status`,
      'GET'
    );

    const a = response.data?.data?.attributes || {};
    const minsToHm = (m) => 
      typeof m === 'number' ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : null;
    
    return {
      batteryPercent: a.batteryLevel ?? null,
      capacityKwh: typeof a.batteryCapacity === 'number' ? a.batteryCapacity / 1000 : null,
      chargePowerKw: typeof a.chargePower === 'number' ? a.chargePower : null,
      isConnected: (a.plugStatus ?? 0) !== 0,
      isCharging: (a.chargeStatus ?? 0) !== 0,
      rangeKm: a.rangeHvacOff ?? null,
      rangeKmHvacOn: a.rangeHvacOn ?? null,
      timeToFull: {
        slow: minsToHm(a.timeRequiredToFullSlow ?? null),
        normal: minsToHm(a.timeRequiredToFullNormal ?? null),
        fast: minsToHm(a.timeRequiredToFullFast ?? null)
      },
      lastUpdateTime: a.lastUpdateTime ?? a.timestamp ?? null
    };
  }

  async getHvacStatus() {
    const { vin } = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;

    console.log('[NissanLeafAPI] Fetching HVAC status...');
    const resp = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${vin}/hvac-status`,
      'GET'
    );

    const a = resp.data?.data?.attributes || {};

    const hvacRaw = a.hvacStatus ?? a.hvacOn ?? a.status;
    const on =
      (typeof hvacRaw === 'string' && hvacRaw.toLowerCase() === 'on') ||
      (typeof hvacRaw === 'number' && hvacRaw !== 0) ||
      hvacRaw === true;

    const insideTempC = a.internalTemperature ?? a.insideTemperature ?? a.interiorTemperature ?? null;
    const outsideTempC = a.externalTemperature ?? a.outsideTemperature ?? null;

    console.log(`[NissanLeafAPI] HVAC status: on=${on}, insideTemp=${insideTempC}`);
    
    return {
      on,
      insideTempC: typeof insideTempC === 'number' ? insideTempC : null,
      outsideTempC: typeof outsideTempC === 'number' ? outsideTempC : null,
      lastUpdateTime: a.lastUpdateTime ?? a.timestamp ?? null
    };
  }

  async startClimateControl(targetTemperature = 21) {
    const session = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;

    // Clamp temperature to valid range (16-30C)
    const clampedTemp = clampTemperature(targetTemperature);
    if (clampedTemp !== targetTemperature) {
      console.log(`[NissanLeafAPI] Temperature ${targetTemperature}C clamped to ${clampedTemp}C`);
    }

    console.log(`[NissanLeafAPI] Starting climate control at ${clampedTemp}C...`);

    const body = {
      data: {
        type: 'HvacStart',
        attributes: {
          action: 'start',
          targetTemperature: clampedTemp
        }
      }
    };

    const response = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${session.vin}/actions/hvac-start`,
      'POST',
      { 'Content-Type': 'application/vnd.api+json' },
      body,
      { timeout: 60000 }
    );

    if (response.status === 200) {
      const actionId = response.data?.data?.id;
      console.log(`[NissanLeafAPI] HVAC start command accepted${actionId ? `, actionId: ${actionId}` : ''}`);
      
      // Fire-and-forget background polling (don't await)
      if (actionId) {
        this._pollClimateAction(actionId, session.vin, 'start');
      } else {
        // No actionId to poll, assume success and notify callback
        if (this._climateCallback) {
          this._climateCallback(true, 'start');
        }
      }
      
      return true; // Return immediately - optimistic success
    }
    
    console.log(`[NissanLeafAPI] HVAC start returned unexpected status: ${response.status}`);
    return false;
  }

  async _refreshHvac(vin) {
    const settings = NISSAN_API_SETTINGS.EU;

    console.log('[NissanLeafAPI] Requesting HVAC refresh...');

    // Some stacks want just a type; others accept an empty attributes object too.
    const variants = [
      { data: { type: 'RefreshHvacStatus' } },
      { data: { type: 'RefreshHvacStatus', attributes: {} } }
    ];

    for (const body of variants) {
      try {
        const resp = await this._requestWithRetry(
          `${settings.car_adapter_base_url}v1/cars/${vin}/actions/refresh-hvac-status`,
          'POST',
          { 'Content-Type': 'application/vnd.api+json' },
          body,
          { timeout: 60000 }
        );
        // 200 means accepted; a few stacks return 202
        if (resp.status === 200 || resp.status === 202) {
          console.log('[NissanLeafAPI] HVAC refresh accepted');
          return true;
        }
      } catch (e) {
        const st = e.response?.status;
        console.log(`[NissanLeafAPI] HVAC refresh variant failed: ${st || e.message}`);
        // Try next variant only for 4xx; bubble up other errors
        if (!(st === 400 || st === 404)) throw e;
      }
    }
    return false;
  }

  async _waitForHvacStatus(vin, expectedOn, options = {}) {
    const attempts = options.attempts || 12; // Increased from 8
    const intervalMs = options.intervalMs || 5000;
    
    console.log(`[NissanLeafAPI] Waiting for HVAC status to be ${expectedOn ? 'ON' : 'OFF'}...`);
    
    let lastStamp = null;
    for (let i = 0; i < attempts; i++) {
      const s = await this.getHvacStatus();
      const stamp = s.lastUpdateTime || null;
      
      console.log(`[NissanLeafAPI] HVAC wait ${i + 1}/${attempts}: on=${s.on}, expected=${expectedOn}`);
      
      if (typeof expectedOn === 'boolean' && s.on === expectedOn) {
        console.log('[NissanLeafAPI] HVAC reached expected state');
        return true;
      }
      if (stamp && stamp !== lastStamp) lastStamp = stamp; // note freshness
      await this._sleep(intervalMs);
    }
    
    console.log('[NissanLeafAPI] HVAC wait timed out');
    return false; // best effort
  }

  /**
   * Send HVAC stop command and return actionId
   * Tries 'stop' action first (for running HVAC), then 'cancel' (for scheduled)
   * @param {string} vin - Vehicle VIN
   * @param {number} targetTemperature - Target temperature (required for stop command)
   * @returns {string|null} actionId if successful, null otherwise
   */
  async _sendHvacStopCommand(vin, targetTemperature = 21) {
    const settings = NISSAN_API_SETTINGS.EU;
    
    // Format datetime with timezone offset (e.g., 2026-02-01T20:34:13+01:00)
    // Must be slightly in the future for the stop command to work
    const now = new Date(Date.now() + 5000); // 5 seconds in the future
    const tzOffset = -now.getTimezoneOffset();
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
    const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const isoBase = now.toISOString().replace('Z', '').split('.')[0];
    const startDateTime = isoBase + tzSign + tzHours + ':' + tzMins;
    
    const variants = [
      // Primary: action 'stop' with startDateTime (correct for stopping running HVAC)
      { 
        data: { 
          type: 'HvacStart', 
          attributes: { 
            action: 'stop',
            targetTemperature,
            startDateTime
          } 
        }, 
        label: 'stop' 
      },
      // Fallback: action 'cancel' (for scheduled sessions)
      { 
        data: { 
          type: 'HvacStart', 
          attributes: { 
            action: 'cancel',
            targetTemperature
          } 
        }, 
        label: 'cancel' 
      }
    ];
    
    for (const { data, label } of variants) {
      try {
        const resp = await this._requestWithRetry(
          `${settings.car_adapter_base_url}v1/cars/${vin}/actions/hvac-start`,
          'POST',
          { 'Content-Type': 'application/vnd.api+json' },
          { data },
          { timeout: 60000 }
        );
        
        if (resp.status === 200) {
          const actionId = resp.data?.data?.id || null;
          console.log(`[NissanLeafAPI] Stop command '${label}' accepted, actionId: ${actionId}`);
          return actionId;
        }
      } catch (e) {
        const st = e.response?.status;
        console.log(`[NissanLeafAPI] Stop variant '${label}' failed: ${st || e.message}`);
        // Continue to next variant for 400/404, otherwise rethrow
        if (!(st === 400 || st === 404)) throw e;
      }
    }
    
    return null;
  }

  /**
   * Background polling for HVAC stop with retry logic
   * Handles REJECTED status by waiting and checking actual HVAC status
   * Retries stop command up to 3 times with exponential backoff
   * @param {string} actionId - Initial action ID from stop command
   * @param {string} vin - Vehicle VIN
   * @param {number} targetTemperature - Target temperature for retry commands
   */
  async _pollClimateStopWithRetry(actionId, vin, targetTemperature = 21) {
    const maxRetries = 3;
    const delays = [5000, 10000, 15000]; // Exponential backoff (increased from 2s/4s/8s)
    
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        // Poll the action ID with longer intervals for Nissan API
        if (actionId) {
          console.log(`[NissanLeafAPI] Stop attempt ${retry}/${maxRetries}, polling action ${actionId}`);
          const success = await this._actionIsCompletedPoll(actionId, vin, {
            attempts: 8,   // 8 attempts x 15s = 2 minutes of polling
            intervalMs: 15000
          });
          
          if (success) {
            console.log('[NissanLeafAPI] HVAC stop confirmed via action poll');
            if (this._climateCallback) this._climateCallback(true, 'stop');
            return true;
          }
        }
        
        // Polling failed/REJECTED - wait then check actual HVAC status
        const delay = delays[Math.min(retry, delays.length - 1)];
        console.log(`[NissanLeafAPI] Stop poll failed, waiting ${delay}ms and checking HVAC status...`);
        await this._sleep(delay);
        
        const hvacStatus = await this.getHvacStatus();
        if (!hvacStatus.on) {
          console.log('[NissanLeafAPI] HVAC confirmed OFF despite REJECTED status');
          if (this._climateCallback) this._climateCallback(true, 'stop');
          return true;
        }
        
        if (retry < maxRetries) {
          console.log(`[NissanLeafAPI] HVAC still ON, sending another stop command (retry ${retry + 1}/${maxRetries})`);
          actionId = await this._sendHvacStopCommand(vin, targetTemperature);
          
          // Also trigger HVAC refresh to help the car update
          this._refreshHvac(vin).catch(() => {});
        }
        
      } catch (e) {
        console.log(`[NissanLeafAPI] Stop retry ${retry} error: ${e.message}`);
      }
    }
    
    // All retries exhausted - do one final HVAC status check
    console.log('[NissanLeafAPI] All stop retries exhausted, final HVAC status check...');
    try {
      const finalStatus = await this.getHvacStatus();
      if (!finalStatus.on) {
        console.log('[NissanLeafAPI] HVAC is OFF after all retries (delayed success)');
        if (this._climateCallback) this._climateCallback(true, 'stop');
        return true;
      }
    } catch (e) {
      console.log('[NissanLeafAPI] Final HVAC check failed:', e.message);
    }
    
    console.log('[NissanLeafAPI] HVAC stop failed after all retries');
    if (this._climateCallback) this._climateCallback(false, 'stop');
    return false;
  }

  async stopClimateControl(targetTemperature = 21) {
    const { vin } = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;

    console.log('[NissanLeafAPI] Stopping climate control...');

    // Format datetime with timezone offset (e.g., 2026-02-01T20:34:13+01:00)
    // Must be slightly in the future for the stop command to work
    const now = new Date(Date.now() + 5000); // 5 seconds in the future
    const tzOffset = -now.getTimezoneOffset();
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
    const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const isoBase = now.toISOString().replace('Z', '').split('.')[0];
    const startDateTime = isoBase + tzSign + tzHours + ':' + tzMins;

    const variants = [
      // Primary: action 'stop' with startDateTime (correct for stopping running HVAC)
      { 
        data: { 
          type: 'HvacStart', 
          attributes: { 
            action: 'stop',
            targetTemperature,
            startDateTime
          } 
        }, 
        label: 'stop' 
      },
      // Fallback: action 'cancel' (for scheduled sessions)
      { 
        data: { 
          type: 'HvacStart', 
          attributes: { 
            action: 'cancel',
            targetTemperature
          } 
        }, 
        label: 'cancel' 
      }
    ];

    let fired = false;
    let actionId = null;
    
    for (const { data, label } of variants) {
      try {
        const resp = await this._requestWithRetry(
          `${settings.car_adapter_base_url}v1/cars/${vin}/actions/hvac-start`,
          'POST',
          { 'Content-Type': 'application/vnd.api+json' },
          { data },
          { timeout: 60000 }
        );
        
        console.log(`[NissanLeafAPI] HVAC off variant '${label}' -> ${resp.status}`);
        if (resp.status === 200) {
          fired = true;
          actionId = resp.data?.data?.id || null;
          break;
        }
      } catch (e) {
        const st = e.response?.status;
        console.log(`[NissanLeafAPI] HVAC off variant '${label}' failed: ${st || e.message}`);
        if (!(st === 400 || st === 404)) throw e;
      }
    }

    if (!fired) {
      console.log('[NissanLeafAPI] All HVAC stop variants failed');
      return false;
    }

    console.log(`[NissanLeafAPI] HVAC stop command accepted${actionId ? `, actionId: ${actionId}` : ''}`);

    // Fire-and-forget: background polling with retry logic for stop commands
    if (actionId) {
      // Use the new retry-aware polling for stop commands
      (async () => {
        try {
          await this._pollClimateStopWithRetry(actionId, vin, targetTemperature);
        } catch (e) {
          console.log(`[NissanLeafAPI] Stop retry error: ${e.message}`);
          if (this._climateCallback) this._climateCallback(false, 'stop');
        }
      })();
    } else {
      // No actionId, do background HVAC status check instead
      this._pollHvacStatusForStop(vin);
    }

    // Try to refresh HVAC status (fire-and-forget)
    this._refreshHvac(vin).catch(e => {
      console.log('[NissanLeafAPI] refresh-hvac-status failed (ignored):', e?.response?.status || e.message);
    });

    return true; // Return immediately - optimistic success
  }

  /**
   * Background polling for HVAC stop confirmation via status check
   * Used when stopClimateControl doesn't return an actionId
   */
  _pollHvacStatusForStop(vin) {
    (async () => {
      try {
        console.log('[NissanLeafAPI] Background polling HVAC status for stop confirmation...');
        
        const success = await this._waitForHvacStatus(vin, false, { 
          attempts: 10, 
          intervalMs: 6000 
        });
        
        console.log(`[NissanLeafAPI] HVAC stop status check result: ${success ? 'confirmed off' : 'still on'}`);
        
        if (this._climateCallback) {
          this._climateCallback(success, 'stop');
        }
      } catch (e) {
        console.log(`[NissanLeafAPI] HVAC stop status polling error: ${e.message}`);
        // Assume success since command was accepted
        if (this._climateCallback) {
          this._climateCallback(true, 'stop');
        }
      }
    })();
  }

  async getCockpit() {
    const { vin } = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;

    console.log('[NissanLeafAPI] Fetching cockpit data...');
    const resp = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${vin}/cockpit`,
      'GET'
    );

    const a = resp.data?.data?.attributes || {};
    const odometerKm =
      (typeof a.totalMileage === 'number' ? a.totalMileage : null) ??
      (typeof a.odometer === 'number' ? a.odometer : null);
    
    console.log(`[NissanLeafAPI] Odometer: ${odometerKm} km`);
    return { odometerKm };
  }

  async getLocation() {
    const { vin } = await this.getSession();
    const settings = NISSAN_API_SETTINGS.EU;

    console.log('[NissanLeafAPI] Fetching location...');
    const resp = await this._requestWithRetry(
      `${settings.car_adapter_base_url}v1/cars/${vin}/location`,
      'GET'
    );

    const a = resp.data?.data?.attributes || {};
    const lat = typeof a.gpsLatitude === 'number' ? a.gpsLatitude : a.latitude ?? null;
    const lon = typeof a.gpsLongitude === 'number' ? a.gpsLongitude : a.longitude ?? null;
    
    console.log(`[NissanLeafAPI] Location: ${lat}, ${lon}`);
    
    return {
      lat,
      lon,
      headingDeg: typeof a.gpsDirection === 'number' ? a.gpsDirection : null,
      lastUpdateTime: a.lastUpdateTime ?? a.timestamp ?? null
    };
  }

  /**
   * Refresh all vehicle data (blocking)
   * Triggers battery and HVAC refresh commands, waits for completion,
   * then fetches all data endpoints
   * @returns {Promise<object>} All vehicle data { battery, hvac, cockpit, location }
   */
  async refreshAllData() {
    const session = await this.getSession();
    const vin = session.vin;
    
    console.log('[NissanLeafAPI] Refreshing all vehicle data...');
    
    // Trigger both refresh commands in parallel
    const refreshPromises = [];
    
    // 1. Battery refresh (with polling)
    refreshPromises.push(
      this._refreshBattery(vin, { attempts: 15, intervalMs: 6000 })
        .catch(e => { console.log('[NissanLeafAPI] Battery refresh failed:', e.message); return false; })
    );
    
    // 2. HVAC refresh (fire-and-forget, no polling needed)
    refreshPromises.push(
      this._refreshHvac(vin)
        .catch(e => { console.log('[NissanLeafAPI] HVAC refresh failed:', e.message); return false; })
    );
    
    // Wait for both refreshes to complete (or fail)
    await Promise.all(refreshPromises);
    
    // Small delay to let car update its caches
    await this._sleep(2000);
    
    // Fetch all fresh data in parallel
    const [battery, hvac, cockpit, location] = await Promise.all([
      this.getBatteryStatus({ skipRefresh: true }),
      this.getHvacStatus(),
      this.getCockpit().catch(() => ({ odometerKm: null })),
      this.getLocation().catch(() => ({ lat: null, lon: null }))
    ]);
    
    console.log('[NissanLeafAPI] All data refreshed successfully');
    
    return { battery, hvac, cockpit, location };
  }
}

module.exports = NissanLeafAPI;
