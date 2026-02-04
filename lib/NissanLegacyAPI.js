'use strict';

const leafConnect = require('leaf-connect');
const { NissanConnectError, ErrorTypes } = require('./errors');
const { RegionCode, getRegionName } = require('./constants');
const {
  mapLegacyBatteryStatus,
  mapLegacyClimateStatus,
  mapLegacyLocation,
  mapLegacyVehicles
} = require('./mappers');

/**
 * NissanLegacyAPI - Wrapper around leaf-connect library for pre-2019 Nissan Leaf models
 * 
 * This class provides a normalized interface similar to NissanConnectAPI but uses
 * the legacy GDC Portal API via the leaf-connect npm package.
 * 
 * Supports regions: NE (Europe), NCI (Canada), NNA (USA), NMA (Australia), NML (Japan)
 */
class NissanLegacyAPI {
  /**
   * Create a new NissanLegacyAPI instance
   * @param {string} username - NissanConnect email
   * @param {string} password - NissanConnect password
   * @param {string} regionCode - Region code (NE, NCI, NNA, NMA, NML)
   */
  constructor(username, password, regionCode = RegionCode.Europe) {
    this.username = username;
    this.password = password;
    this.regionCode = regionCode;
    
    this._client = null;
    this._session = null;
    this._lastAuthTime = null;
    this._sessionMaxAge = 60 * 60 * 1000; // 1 hour session validity
  }

  /**
   * Get or create an authenticated client
   * Caches the session to avoid re-authenticating on every call
   * @returns {Promise<object>} The authenticated leaf-connect client
   * @throws {NissanConnectError} On authentication failure
   */
  async _getClient() {
    const now = Date.now();
    
    // Check if we have a valid cached session
    if (this._client && this._lastAuthTime && (now - this._lastAuthTime) < this._sessionMaxAge) {
      return this._client;
    }
    
    // Create new client (authenticates)
    console.log(`[NissanLegacyAPI] Creating new client session for ${getRegionName(this.regionCode)}...`);
    
    try {
      this._client = await leafConnect({
        username: this.username,
        password: this.password,
        regionCode: this.regionCode
      });
      
      this._lastAuthTime = now;
      this._session = this._client.sessionInfo();
      
      console.log('[NissanLegacyAPI] Session established successfully');
      return this._client;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Authentication failed:', error.message);
      this._client = null;
      this._session = null;
      this._lastAuthTime = null;
      
      throw new NissanConnectError({
        name: ErrorTypes.AUTH_FAILED,
        message: 'Failed to authenticate with Nissan Connect',
        cause: error
      });
    }
  }

  /**
   * Invalidate cached session (force re-auth on next call)
   */
  invalidateSession() {
    this._client = null;
    this._session = null;
    this._lastAuthTime = null;
  }

  /**
   * Get session info for validation during pairing
   * @returns {Promise<object>} Session information
   * @throws {NissanConnectError} On failure
   */
  async getSession() {
    const client = await this._getClient();
    return client.sessionInfo();
  }

  /**
   * Get battery status (cached, faster)
   * @returns {Promise<object>} Normalized battery status
   * @throws {NissanConnectError} On failure
   */
  async getBatteryStatus() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Fetching cached battery status...');
    
    try {
      const rawStatus = await client.cachedStatus();
      const status = mapLegacyBatteryStatus(rawStatus);
      
      console.log(`[NissanLegacyAPI] Battery: ${status.batteryPercent}%, Range: ${status.rangeKm}km, Charging: ${status.isCharging}, Connected: ${status.isConnected}`);
      
      return status;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to get battery status:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.BATTERY_STATUS_UNAVAILABLE,
        message: 'Failed to retrieve battery status',
        cause: error
      });
    }
  }

  /**
   * Get fresh battery status (wakes the car, slower)
   * Note: This is a blocking call that can take 30+ seconds
   * @returns {Promise<object>} Normalized battery status
   * @throws {NissanConnectError} On failure
   */
  async refreshBatteryStatus() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Requesting fresh battery status (this may take a while)...');
    
    try {
      const rawStatus = await client.status();
      const status = mapLegacyBatteryStatus(rawStatus);
      
      console.log(`[NissanLegacyAPI] Fresh Battery: ${status.batteryPercent}%, Range: ${status.rangeKm}km`);
      
      return status;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to refresh battery status:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.BATTERY_STATUS_UNAVAILABLE,
        message: 'Failed to refresh battery status',
        cause: error
      });
    }
  }

  /**
   * Get climate control status
   * @returns {Promise<object>} Normalized climate status
   * @throws {NissanConnectError} On failure
   */
  async getClimateStatus() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Fetching climate status...');
    
    try {
      const rawStatus = await client.climateControlStatus();
      const status = mapLegacyClimateStatus(rawStatus);
      
      console.log(`[NissanLegacyAPI] Climate: ${status.on ? 'ON' : 'OFF'}`);
      
      return status;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to get climate status:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.CLIMATE_CONTROL_UNAVAILABLE,
        message: 'Failed to retrieve climate status',
        cause: error
      });
    }
  }

  /**
   * Start climate control
   * Note: Legacy API does not support setting temperature
   * @returns {Promise<boolean>} Success status
   * @throws {NissanConnectError} On failure
   */
  async startClimate() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Starting climate control...');
    
    try {
      await client.climateControlTurnOn();
      console.log('[NissanLegacyAPI] Climate control started successfully');
      return true;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to start climate:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.CLIMATE_CONTROL_UNAVAILABLE,
        message: 'Failed to start climate control',
        cause: error
      });
    }
  }

  /**
   * Stop climate control
   * @returns {Promise<boolean>} Success status
   * @throws {NissanConnectError} On failure
   */
  async stopClimate() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Stopping climate control...');
    
    try {
      await client.climateControlTurnOff();
      console.log('[NissanLegacyAPI] Climate control stopped successfully');
      return true;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to stop climate:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.CLIMATE_CONTROL_UNAVAILABLE,
        message: 'Failed to stop climate control',
        cause: error
      });
    }
  }

  /**
   * Start charging
   * Note: Legacy API only supports start, not stop
   * @returns {Promise<boolean>} Success status
   * @throws {NissanConnectError} On failure
   */
  async startCharging() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Starting charging...');
    
    try {
      await client.chargingStart();
      console.log('[NissanLegacyAPI] Charging started successfully');
      return true;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to start charging:', error.message);
      
      throw new NissanConnectError({
        name: ErrorTypes.CHARGING_UNAVAILABLE,
        message: 'Failed to start charging',
        cause: error
      });
    }
  }

  /**
   * Get vehicle location
   * @returns {Promise<object>} Location with lat/lon
   */
  async getLocation() {
    const client = await this._getClient();
    
    console.log('[NissanLegacyAPI] Fetching last known location...');
    
    try {
      const rawLocation = await client.lastLocation();
      const location = mapLegacyLocation(rawLocation);
      
      console.log(`[NissanLegacyAPI] Location: ${location.lat}, ${location.lon}`);
      
      return location;
      
    } catch (error) {
      console.error('[NissanLegacyAPI] Failed to get location:', error.message);
      // Location is optional, return null coordinates instead of throwing
      return { lat: null, lon: null };
    }
  }

  /**
   * Get vehicles from session (for pairing)
   * @returns {Promise<Array>} Array of normalized vehicle objects
   * @throws {NissanConnectError} On failure
   */
  async getVehicles() {
    try {
      const session = await this.getSession();
      const vehicles = mapLegacyVehicles(session);
      
      if (vehicles.length === 0) {
        throw new NissanConnectError({
          name: ErrorTypes.VEHICLE_UNAVAILABLE,
          message: 'No vehicles found on this account'
        });
      }
      
      return vehicles;
      
    } catch (error) {
      if (error instanceof NissanConnectError) throw error;
      
      throw new NissanConnectError({
        name: ErrorTypes.VEHICLE_UNAVAILABLE,
        message: 'Failed to retrieve vehicles',
        cause: error
      });
    }
  }

  /**
   * Refresh all vehicle data (blocking)
   * Requests fresh battery status (wakes car), then fetches climate and location
   * @returns {Promise<object>} All vehicle data { battery, climate, location }
   */
  async refreshAllData() {
    console.log('[NissanLegacyAPI] Refreshing all vehicle data...');
    
    // Request fresh battery status (this wakes the car)
    const battery = await this.refreshBatteryStatus();
    
    // Now fetch climate and location with fresh data
    const [climate, location] = await Promise.all([
      this.getClimateStatus().catch(() => ({ on: false })),
      this.getLocation().catch(() => ({ lat: null, lon: null }))
    ]);
    
    console.log('[NissanLegacyAPI] All data refreshed successfully');
    
    return { battery, climate, location };
  }
}

// Export the class and also the RegionCode for convenience
module.exports = NissanLegacyAPI;
module.exports.RegionCode = RegionCode;
