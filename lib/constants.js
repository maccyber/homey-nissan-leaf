'use strict';

/**
 * Region codes for Nissan Connect APIs
 * Used by both Legacy (Carwings) and Modern (Kamereon) APIs
 */
const RegionCode = {
  Europe: 'NE',
  USA: 'NNA',
  Canada: 'NCI',
  Australia: 'NMA',
  Japan: 'NML'
};

/**
 * Get region display name from code
 * @param {string} code - Region code
 * @returns {string} Human-readable region name
 */
function getRegionName(code) {
  const names = {
    NE: 'Europe',
    NNA: 'USA',
    NCI: 'Canada',
    NMA: 'Australia',
    NML: 'Japan'
  };
  return names[code] || code;
}

/**
 * Charging status values from API responses
 */
const ChargingStatus = {
  NOT_CHARGING: 'NOT_CHARGING',
  CHARGING: 'CHARGING',
  NORMAL_CHARGING: 'NORMAL_CHARGING',
  RAPIDLY_CHARGING: 'RAPIDLY_CHARGING',
  YES: 'YES',
  NO: 'NO'
};

/**
 * Plugin/connector state values
 */
const PluginState = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  CONNECTED: 'CONNECTED',
  QC_CONNECTED: 'QC_CONNECTED',
  INVALID: 'INVALID'
};

/**
 * HVAC/Climate operation states
 */
const HvacState = {
  ON: 'ON',
  OFF: 'OFF',
  START: 'START',
  STOP: 'STOP'
};

/**
 * Action polling states (Kamereon API)
 */
const ActionStatus = {
  // In-progress states
  PRISTINE: 'PRISTINE',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  STARTED: 'STARTED',
  QUEUED: 'QUEUED',
  
  // Success states
  COMPLETED: 'COMPLETED',
  SUCCESS: 'SUCCESS',
  DONE: 'DONE',
  
  // Failure states
  FAILED: 'FAILED',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
  ABORTED: 'ABORTED',
  REJECTED: 'REJECTED'
};

/**
 * Temperature constraints for Nissan API (Celsius)
 */
const TemperatureLimits = {
  MIN: 16,
  MAX: 30,
  DEFAULT: 21
};

/**
 * Validate and clamp temperature to valid range
 * @param {number} temperature - Temperature in Celsius
 * @returns {number} Clamped temperature
 */
function clampTemperature(temperature) {
  const temp = Math.round(temperature);
  return Math.min(TemperatureLimits.MAX, Math.max(TemperatureLimits.MIN, temp));
}

/**
 * Check if temperature is within valid range
 * @param {number} temperature - Temperature in Celsius
 * @returns {boolean}
 */
function isValidTemperature(temperature) {
  return temperature >= TemperatureLimits.MIN && temperature <= TemperatureLimits.MAX;
}

/**
 * Check if a charging status indicates active charging
 * @param {string} status - Charging status from API
 * @returns {boolean}
 */
function isChargingActive(status) {
  return status === ChargingStatus.CHARGING ||
         status === ChargingStatus.NORMAL_CHARGING ||
         status === ChargingStatus.RAPIDLY_CHARGING ||
         status === ChargingStatus.YES;
}

/**
 * Check if a plugin state indicates connected to charger
 * @param {string} state - Plugin state from API
 * @returns {boolean}
 */
function isPluggedIn(state) {
  return state === PluginState.CONNECTED ||
         state === PluginState.QC_CONNECTED;
}

/**
 * Check if action status indicates completion
 * @param {string} status - Action status from API
 * @returns {boolean}
 */
function isActionComplete(status) {
  const s = (status || '').toString().toUpperCase();
  return s === ActionStatus.COMPLETED || 
         s === ActionStatus.SUCCESS || 
         s === ActionStatus.DONE;
}

/**
 * Check if action status indicates failure
 * @param {string} status - Action status from API
 * @returns {boolean}
 */
function isActionFailed(status) {
  const s = (status || '').toString().toUpperCase();
  return s === ActionStatus.FAILED || 
         s === ActionStatus.ERROR || 
         s === ActionStatus.CANCELLED || 
         s === ActionStatus.ABORTED || 
         s === ActionStatus.REJECTED;
}

/**
 * Polling configuration
 */
const PollingConfig = {
  // Default intervals in milliseconds
  DEFAULT_POLL_INTERVAL: 5000,      // 5 seconds between polls
  MAX_POLL_ATTEMPTS: 10,            // Maximum polling attempts
  REFRESH_TIMEOUT: 90000,           // 90 seconds for refresh operations
  CLIMATE_TIMEOUT: 60000            // 60 seconds for climate operations
};

module.exports = {
  // Region codes
  RegionCode,
  getRegionName,
  
  // Status enums
  ChargingStatus,
  PluginState,
  HvacState,
  ActionStatus,
  
  // Temperature
  TemperatureLimits,
  clampTemperature,
  isValidTemperature,
  
  // Status helpers
  isChargingActive,
  isPluggedIn,
  isActionComplete,
  isActionFailed,
  
  // Polling config
  PollingConfig
};
