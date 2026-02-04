'use strict';

/**
 * Custom error class for Nissan Connect API errors
 * Provides typed errors with optional cause for better debugging
 */
class NissanConnectError extends Error {
  /**
   * Create a new NissanConnectError
   * @param {Object} options - Error options
   * @param {string} options.name - Error type name (use ErrorTypes constants)
   * @param {string} options.message - Human-readable error message
   * @param {*} [options.cause] - Original error or additional context
   * @param {string} [options.code] - Optional error code for programmatic handling
   */
  constructor({ name, message, cause = null, code = null }) {
    super(message);
    this.name = name;
    this.cause = cause;
    this.code = code;
    
    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NissanConnectError);
    }
  }

  /**
   * Create a user-friendly error message based on error type
   * @returns {string} User-friendly message
   */
  getUserMessage() {
    switch (this.name) {
      case ErrorTypes.NOT_LOGGED_IN:
      case ErrorTypes.AUTH_FAILED:
        return 'Login failed. Please check your credentials.';
      case ErrorTypes.SESSION_EXPIRED:
        return 'Session expired. Reconnecting...';
      case ErrorTypes.VEHICLE_UNAVAILABLE:
        return 'Could not connect to vehicle. Please try again later.';
      case ErrorTypes.BATTERY_STATUS_UNAVAILABLE:
        return 'Could not retrieve battery status. The vehicle may be asleep.';
      case ErrorTypes.CLIMATE_CONTROL_UNAVAILABLE:
        return 'Could not control climate. Please try again.';
      case ErrorTypes.CHARGING_UNAVAILABLE:
        return 'Could not start charging. Is the vehicle connected?';
      case ErrorTypes.LOCATION_UNAVAILABLE:
        return 'Could not retrieve vehicle location.';
      case ErrorTypes.API_TIMEOUT:
        return 'Request timed out. The vehicle may be in a low-signal area.';
      case ErrorTypes.INVALID_TEMPERATURE:
        return 'Temperature must be between 16C and 30C.';
      default:
        return this.message || 'An unexpected error occurred.';
    }
  }
}

/**
 * Error type constants for programmatic error handling
 */
const ErrorTypes = {
  // Authentication errors
  NOT_LOGGED_IN: 'NotLoggedInError',
  AUTH_FAILED: 'AuthenticationFailedError',
  SESSION_EXPIRED: 'SessionExpiredError',
  
  // Vehicle errors
  VEHICLE_UNAVAILABLE: 'VehicleUnavailableError',
  
  // Feature-specific errors
  BATTERY_STATUS_UNAVAILABLE: 'BatteryStatusUnavailableError',
  CLIMATE_CONTROL_UNAVAILABLE: 'ClimateControlUnavailableError',
  CHARGING_UNAVAILABLE: 'ChargingUnavailableError',
  LOCATION_UNAVAILABLE: 'LocationUnavailableError',
  
  // General API errors
  API_TIMEOUT: 'ApiTimeoutError',
  API_ERROR: 'ApiError',
  
  // Validation errors
  INVALID_TEMPERATURE: 'InvalidTemperatureError',
  INVALID_PARAMETER: 'InvalidParameterError'
};

/**
 * Helper to check if an error is a NissanConnectError of a specific type
 * @param {Error} error - The error to check
 * @param {string} type - The error type to check for
 * @returns {boolean}
 */
function isErrorType(error, type) {
  return error instanceof NissanConnectError && error.name === type;
}

/**
 * Helper to check if an error is authentication-related
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
function isAuthError(error) {
  if (!(error instanceof NissanConnectError)) return false;
  return [
    ErrorTypes.NOT_LOGGED_IN,
    ErrorTypes.AUTH_FAILED,
    ErrorTypes.SESSION_EXPIRED
  ].includes(error.name);
}

module.exports = {
  NissanConnectError,
  ErrorTypes,
  isErrorType,
  isAuthError
};
