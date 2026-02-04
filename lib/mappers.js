'use strict';

const { isChargingActive, isPluggedIn } = require('./constants');

/**
 * ========================================
 * UTILITY FUNCTIONS
 * ========================================
 */

/**
 * Parse a value to number, handling strings
 * @param {*} value - Value to parse
 * @returns {number|null} Parsed number or null
 */
function parseNumber(value) {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Convert meters to kilometers, rounded
 * @param {*} meters - Value in meters
 * @returns {number|null} Value in km or null
 */
function parseMetersToKm(meters) {
  const value = parseNumber(meters);
  return value !== null ? Math.round(value / 1000) : null;
}

/**
 * Safely get nested property from object
 * @param {Object} obj - Object to get property from
 * @param {string} path - Dot-separated path (e.g., 'data.attributes.value')
 * @param {*} defaultValue - Default value if path not found
 * @returns {*} Value at path or default
 */
function getPath(obj, path, defaultValue = null) {
  if (!obj || typeof obj !== 'object') return defaultValue;
  
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return defaultValue;
    current = current[part];
  }
  
  return current !== undefined ? current : defaultValue;
}

/**
 * ========================================
 * LEGACY API MAPPERS (pre-2019 / Carwings)
 * ========================================
 */

/**
 * Map legacy battery status response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized battery status
 */
function mapLegacyBatteryStatus(rawResponse) {
  const records = rawResponse?.BatteryStatusRecords || {};
  const batteryStatus = records.BatteryStatus || {};
  
  // Parse SOC (State of Charge) - may be in different locations
  const soc = batteryStatus.SOC?.Value;
  const batteryPercent = parseNumber(soc);
  
  // Range is in meters, convert to km
  const rangeKm = parseMetersToKm(records.CruisingRangeAcOff);
  const rangeAcOnKm = parseMetersToKm(records.CruisingRangeAcOn);
  
  // Status flags
  const chargingStatus = batteryStatus.BatteryChargingStatus || 'NOT_CHARGING';
  const pluginState = records.PluginState || 'NOT_CONNECTED';
  
  // Time to full charge
  const minutesToFull = parseNumber(records.TimeRequiredToFull?.MinutesRequiredToFull);
  const minutesToFull200 = parseNumber(records.TimeRequiredToFull200?.MinutesRequiredToFull);
  
  // Battery capacity info
  const batteryCapacity = parseNumber(batteryStatus.BatteryCapacity);
  const batteryRemainingWh = parseNumber(batteryStatus.BatteryRemainingAmountWH);
  const batteryRemainingKwh = parseNumber(batteryStatus.BatteryRemainingAmountkWH);
  
  return {
    batteryPercent,
    rangeKm,
    rangeAcOnKm,
    isCharging: isChargingActive(chargingStatus),
    isConnected: isPluggedIn(pluginState),
    chargingStatus,
    pluginState,
    minutesToFull,
    minutesToFull200,
    batteryCapacity,
    batteryRemainingWh,
    batteryRemainingKwh,
    lastUpdateTime: records.OperationDateAndTime || null
  };
}

/**
 * Map legacy climate status response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized climate status
 */
function mapLegacyClimateStatus(rawResponse) {
  const records = rawResponse?.RemoteACRecords;
  
  let isOn = false;
  if (records) {
    const operationResult = String(records.OperationResult || '');
    const remoteACOperation = records.RemoteACOperation || '';
    
    // Climate is ON if operation started successfully
    isOn = operationResult.startsWith('START') && remoteACOperation === 'START';
  }
  
  // Duration info
  const durationBatterySec = parseNumber(records?.ACDurationBatterySec);
  const durationPluggedSec = parseNumber(records?.ACDurationPluggedSec);
  
  return {
    on: isOn,
    operationResult: records?.OperationResult,
    remoteACOperation: records?.RemoteACOperation,
    durationBatterySec,
    durationPluggedSec,
    lastUpdateTime: records?.ACStartStopDateAndTime || null
  };
}

/**
 * Map legacy location response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized location
 */
function mapLegacyLocation(rawResponse) {
  // Location can be in different formats depending on API version
  const lat = rawResponse?.lat || 
              rawResponse?.receiverState?.latitude || 
              rawResponse?.sanityCheckInformation?.Latitude ||
              null;
              
  const lon = rawResponse?.lng || 
              rawResponse?.lon || 
              rawResponse?.receiverState?.longitude ||
              rawResponse?.sanityCheckInformation?.Longitude ||
              null;
  
  return {
    lat: parseNumber(lat),
    lon: parseNumber(lon),
    lastUpdateTime: rawResponse?.receivedDate || null
  };
}

/**
 * Map legacy vehicle info from session to normalized format
 * @param {Object} sessionInfo - Session info from login
 * @returns {Array} Array of normalized vehicle objects
 */
function mapLegacyVehicles(sessionInfo) {
  // Handle different response formats between API versions
  const vehicles = sessionInfo?.vehicleInfo || 
                   sessionInfo?.VehicleInfoList?.vehicleInfo ||
                   sessionInfo?.VehicleInfoList?.VehicleInfo || 
                   [];
  
  const vehicleArray = Array.isArray(vehicles) ? vehicles : [vehicles];
  
  return vehicleArray
    .filter(v => v) // Remove null/undefined entries
    .map(vehicle => ({
      vin: vehicle.vin || vehicle.custom_sessionid,
      nickname: vehicle.nickname || 'Nissan Leaf',
      customSessionId: vehicle.custom_sessionid,
      dcmId: vehicle.dcmId || vehicle.profile?.dcmId,
      modelYear: vehicle.modelYear
    }));
}

/**
 * ========================================
 * KAMEREON API MAPPERS (2019+ / Modern)
 * ========================================
 */

/**
 * Map Kamereon battery status response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized battery status
 */
function mapKamereonBatteryStatus(rawResponse) {
  const attrs = getPath(rawResponse, 'data.attributes', {});
  
  const batteryPercent = parseNumber(attrs.batteryLevel);
  const rangeKm = parseNumber(attrs.batteryAutonomy);
  
  // Kamereon uses numeric status codes
  const isCharging = attrs.chargingStatus > 0;
  const isConnected = attrs.plugStatus > 0;
  
  // Charge power in kW
  const chargePowerKw = parseNumber(attrs.chargePower);
  
  // Time remaining in minutes
  const chargeTimeRemaining = parseNumber(attrs.chargingRemainingTime);
  
  return {
    batteryPercent,
    rangeKm,
    isCharging,
    isConnected,
    chargePowerKw,
    chargeTimeRemaining,
    chargingStatus: attrs.chargingStatus,
    plugStatus: attrs.plugStatus,
    lastUpdateTime: attrs.timestamp || null
  };
}

/**
 * Map Kamereon HVAC status response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized HVAC status
 */
function mapKamereonHvacStatus(rawResponse) {
  const attrs = getPath(rawResponse, 'data.attributes', {});
  
  const hvacStatus = attrs.hvacStatus || '';
  const isOn = hvacStatus.toLowerCase() === 'on';
  
  return {
    on: isOn,
    hvacStatus,
    insideTempC: parseNumber(attrs.internalTemperature),
    targetTempC: parseNumber(attrs.targetTemperature),
    externalTempC: parseNumber(attrs.externalTemperature),
    lastUpdateTime: attrs.lastUpdateTime || null
  };
}

/**
 * Map Kamereon cockpit response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized cockpit data
 */
function mapKamereonCockpit(rawResponse) {
  const attrs = getPath(rawResponse, 'data.attributes', {});
  
  return {
    odometerKm: parseNumber(attrs.totalMileage),
    fuelAutonomy: parseNumber(attrs.fuelAutonomy),
    fuelQuantity: parseNumber(attrs.fuelQuantity)
  };
}

/**
 * Map Kamereon location response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized location
 */
function mapKamereonLocation(rawResponse) {
  const attrs = getPath(rawResponse, 'data.attributes', {});
  
  return {
    lat: parseNumber(attrs.gpsLatitude),
    lon: parseNumber(attrs.gpsLongitude),
    heading: parseNumber(attrs.gpsDirection),
    lastUpdateTime: attrs.lastUpdateTime || null
  };
}

/**
 * Map Kamereon action response to normalized format
 * @param {Object} rawResponse - Raw API response
 * @returns {Object} Normalized action info
 */
function mapKamereonAction(rawResponse) {
  const data = rawResponse?.data || {};
  
  return {
    actionId: data.id,
    type: data.type,
    status: getPath(data, 'attributes.status'),
    lastUpdateTime: getPath(data, 'attributes.lastUpdateTime')
  };
}

module.exports = {
  // Legacy mappers
  mapLegacyBatteryStatus,
  mapLegacyClimateStatus,
  mapLegacyLocation,
  mapLegacyVehicles,
  
  // Kamereon mappers
  mapKamereonBatteryStatus,
  mapKamereonHvacStatus,
  mapKamereonCockpit,
  mapKamereonLocation,
  mapKamereonAction,
  
  // Utilities
  parseNumber,
  parseMetersToKm,
  getPath
};
