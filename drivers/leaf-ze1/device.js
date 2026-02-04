'use strict';

const Homey = require('homey');
const NissanConnectAPI = require('../../lib/NissanConnectAPI');

class LeafZE1Device extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Nissan Leaf (2019+) device has been initialized');

    // Migrate capabilities for existing devices
    await this.migrateCapabilities();

    // Clean up initial data from store (no longer needed after device is initialized)
    const store = this.getStore();
    if (store.initialData) {
      await this.setStoreValue('initialData', null);
      this.log('Cleaned up initial pairing data from store');
    }

    // Get stored credentials
    const settings = this.getSettings();
    
    // Initialize API
    this.api = new NissanConnectAPI(
      store.username,
      store.password,
      settings.vin
    );

    // Set up callback for when background refresh completes
    this.api.setRefreshCallback(this.onBackgroundRefreshComplete.bind(this));

    // Set up callback for when climate command completes
    this.api.setClimateCallback(this.onClimateCommandResult.bind(this));

    // Register capability listeners
    this.registerCapabilityListener('onoff.climate', this.onCapabilityClimate.bind(this));
    this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
    this.registerCapabilityListener('button_refresh_all', this.onRefreshAllButton.bind(this));

    // Store previous states for triggers
    this.previousCharging = false;
    this.previousConnected = false;
    this.previousClimateOn = false;

    // Persistent climate state
    this.persistentClimateActive = false;
    this.persistentClimateStartTime = null;
    this.persistentClimateTemperature = 21;
    this.lastKnownLocation = null;

    // Initialize refreshing status
    await this.setCapabilityValue('refreshing_status', false).catch(this.error);

    // Start polling with smart intervals
    this.currentPollingMode = 'idle'; // 'idle', 'charging', or 'keep_awake'
    this.startPolling();
    
    // Do initial update (skip refresh on first load to be fast)
    await this.updateVehicleData({ skipRefresh: true });
  }

  /**
   * Migrate capabilities for existing devices when driver is updated
   */
  async migrateCapabilities() {
    // Capabilities that should exist on this device
    const requiredCapabilities = [
      'measure_battery',
      'measure_range',
      'measure_charge_power',
      'measure_odometer',
      'measure_temperature.inside',
      'onoff.climate',
      'target_temperature',
      'charging_status',
      'connected_status',
      'refreshing_status',
      'button_refresh_all',
      'measure_latitude',
      'measure_longitude'
    ];

    // Add missing capabilities
    for (const capability of requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        this.log(`Adding missing capability: ${capability}`);
        try {
          await this.addCapability(capability);
        } catch (error) {
          this.error(`Failed to add capability ${capability}:`, error.message);
        }
      }
    }
  }

  /**
   * onAdded is called when the user adds the device.
   */
  async onAdded() {
    this.log('Nissan Leaf (2019+) device has been added');
    
    // Populate capabilities from initial data (fetched during pairing)
    const store = this.getStore();
    if (store.initialData) {
      this.log('Initial data available from pairing, populating capabilities');
      await this.populateFromData(store.initialData, true);
    } else {
      this.log('No initial data from pairing, will fetch on first init');
    }
  }

  /**
   * Populate capabilities from data object
   * @param {Object} data - Vehicle data { battery, hvac, cockpit, location }
   * @param {boolean} verbose - Whether to log each value
   */
  async populateFromData(data, verbose = false) {
    // Battery data
    if (data.battery) {
      const b = data.battery;
      if (b.batteryPercent !== null) {
        await this.setCapabilityValue('measure_battery', b.batteryPercent).catch(this.error);
        if (verbose) this.log('  Battery: ' + b.batteryPercent + '%');
      }
      if (b.rangeKm !== null) {
        await this.setCapabilityValue('measure_range', b.rangeKm).catch(this.error);
        if (verbose) this.log('  Range: ' + b.rangeKm + 'km');
      }
      
      const isConnected = b.isConnected || false;
      const isCharging = b.isCharging || false;
      await this.setCapabilityValue('charging_status', isCharging).catch(this.error);
      await this.setCapabilityValue('connected_status', isConnected).catch(this.error);
      if (verbose) this.log('  Charging: ' + isCharging + ', Connected: ' + isConnected);
      
      const chargePower = isCharging ? (b.chargePowerKw || 0) : 0;
      await this.setCapabilityValue('measure_charge_power', chargePower).catch(this.error);
      
      // Set previous states for trigger comparison
      this.previousCharging = isCharging;
      this.previousConnected = isConnected;
    }

    // HVAC data
    if (data.hvac) {
      const h = data.hvac;
      if (h.insideTempC !== null) {
        await this.setCapabilityValue('measure_temperature.inside', h.insideTempC).catch(this.error);
        if (verbose) this.log('  Inside temp: ' + h.insideTempC + '°C');
      }
      const climateOn = h.on || false;
      await this.setCapabilityValue('onoff.climate', climateOn).catch(this.error);
      if (verbose) this.log('  Climate on: ' + climateOn);
      this.previousClimateOn = climateOn;
    }

    // Cockpit data (odometer)
    if (data.cockpit && data.cockpit.odometerKm !== null) {
      await this.setCapabilityValue('measure_odometer', data.cockpit.odometerKm).catch(this.error);
      if (verbose) this.log('  Odometer: ' + data.cockpit.odometerKm + 'km');
    }

    // Location data
    if (data.location) {
      const loc = data.location;
      if (loc.lat !== null && loc.lon !== null) {
        await this.setCapabilityValue('measure_latitude', loc.lat).catch(this.error);
        await this.setCapabilityValue('measure_longitude', loc.lon).catch(this.error);
        if (verbose) this.log('  Location: ' + loc.lat + ', ' + loc.lon);
        this.lastKnownLocation = { lat: loc.lat, lon: loc.lon };
      }
    }
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings were changed');

    // Check if any polling-related settings changed
    const pollingKeys = ['polling_interval_idle', 'polling_interval_charging', 'keep_awake'];
    if (pollingKeys.some(key => changedKeys.includes(key))) {
      this.log('Polling settings changed, restarting polling');
      this.stopPolling();
      this.startPolling();
    }

    if (changedKeys.includes('vin')) {
      this.log('VIN changed, reinitializing API');
      const store = this.getStore();
      this.api = new NissanConnectAPI(
        store.username,
        store.password,
        newSettings.vin
      );
      this.api.setRefreshCallback(this.onBackgroundRefreshComplete.bind(this));
      this.api.setClimateCallback(this.onClimateCommandResult.bind(this));
      await this.updateVehicleData({ skipRefresh: true });
    }
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('Nissan Leaf (2019+) device has been deleted');
    
    // Mark device as deleted so async callbacks bail out
    this._deleted = true;
    
    // Stop polling interval
    this.stopPolling();
    
    // Clear persistent climate state
    this.persistentClimateActive = false;
    this.persistentClimateStartTime = null;
    
    this.log('Device cleanup complete');
  }

  /**
   * Callback when background refresh completes
   */
  async onBackgroundRefreshComplete(success, data) {
    if (this._deleted) {
      this.log('Background refresh callback ignored - device was deleted');
      return;
    }
    
    this.log(`Background refresh completed: success=${success}`);
    
    await this.setCapabilityValue('refreshing_status', false).catch(this.error);
    
    if (success && data) {
      if (data.batteryPercent !== null) {
        await this.setCapabilityValue('measure_battery', data.batteryPercent).catch(this.error);
      }
      if (data.rangeKm !== null) {
        await this.setCapabilityValue('measure_range', data.rangeKm).catch(this.error);
      }
      
      // Trigger data_refreshed flow card
      try {
        await this.homey.flow.getDeviceTriggerCard('data_refreshed')
          .trigger(this, {
            battery: data.batteryPercent || 0,
            range: data.rangeKm || 0
          });
      } catch (err) {
        this.error('Failed to trigger data_refreshed:', err);
      }
    }
  }

  /**
   * Callback when climate command polling completes
   */
  async onClimateCommandResult(success, action) {
    if (this._deleted) {
      this.log(`Climate ${action} callback ignored - device was deleted`);
      return;
    }
    
    this.log(`Climate ${action} polling completed: success=${success}`);
    
    if (success) {
      await this.setCapabilityValue('onoff.climate', action === 'start').catch(this.error);
      await this.homey.notifications.createNotification({ 
        excerpt: action === 'start' ? 'Climate control started' : 'Climate control stopped' 
      }).catch(this.error);
      
      const triggerCard = action === 'start' ? 'climate_started' : 'climate_stopped';
      await this.homey.flow.getDeviceTriggerCard(triggerCard)
        .trigger(this)
        .catch(this.error);
    } else {
      // Command failed - revert to opposite state
      await this.setCapabilityValue('onoff.climate', action !== 'start').catch(this.error);
      await this.homey.notifications.createNotification({ 
        excerpt: `Climate ${action} failed - please try again` 
      }).catch(this.error);
    }
  }

  /**
   * Handle climate on/off capability changes from UI
   */
  async onCapabilityClimate(value) {
    this.log('Climate control capability changed to:', value);
    
    try {
      if (value) {
        const targetTemp = this.getCapabilityValue('target_temperature') || 21;
        await this.homey.notifications.createNotification({ excerpt: 'Starting climate control...' }).catch(this.error);
        await this.startClimateControl(targetTemp);
      } else {
        await this.homey.notifications.createNotification({ excerpt: 'Stopping climate control...' }).catch(this.error);
        if (this.persistentClimateActive) {
          await this.stopPersistentClimate();
        } else {
          await this.stopClimateControl();
        }
      }
    } catch (error) {
      this.error('Climate control error:', error);
      await this.setCapabilityValue('onoff.climate', !value).catch(this.error);
      throw error;
    }
  }

  async onCapabilityTargetTemperature(value) {
    const temperature = Math.min(30, Math.max(16, Math.round(value)));
    this.log('Target temperature changed to:', temperature);
    
    // If climate is on, restart it with new temperature
    const climateOn = this.getCapabilityValue('onoff.climate');
    if (climateOn) {
      try {
        await this.startClimateControl(temperature);
        if (this.persistentClimateActive) {
          this.persistentClimateTemperature = temperature;
        }
      } catch (error) {
        this.error('Failed to update temperature:', error);
        throw error;
      }
    }
  }

  /**
   * Smart Polling - adjusts interval based on charging state
   */
  startPolling() {
    const settings = this.getSettings();
    const isConnected = this.getCapabilityValue('connected_status') || false;
    const keepAwake = settings.keep_awake || false;
    
    let mode, intervalMinutes;
    
    if (keepAwake) {
      mode = 'keep_awake';
      intervalMinutes = 30;
    } else if (isConnected) {
      mode = 'charging';
      intervalMinutes = settings.polling_interval_charging || 10;
    } else {
      mode = 'idle';
      intervalMinutes = settings.polling_interval_idle || 60;
    }
    
    const intervalMs = intervalMinutes * 60 * 1000;

    this.log(`Starting ${mode} polling every ${intervalMinutes} minutes`);
    this.currentPollingMode = mode;
    
    this.pollingInterval = this.homey.setInterval(
      async () => {
        try {
          await this.updateVehicleData({ skipRefresh: true });
        } catch (error) {
          this.error('Polling error:', error);
        }
      },
      intervalMs
    );
  }

  stopPolling() {
    if (this.pollingInterval) {
      this.log('Stopping polling');
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Restart polling if charging state changed
   */
  checkAndUpdatePollingInterval(isConnected) {
    const newMode = isConnected ? 'charging' : 'idle';
    
    if (newMode !== this.currentPollingMode) {
      this.log(`Charging state changed, switching to ${newMode} polling`);
      this.stopPolling();
      this.startPolling();
    }
  }

  /**
   * Calculate distance between two GPS points using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
      return 0;
    }
    
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Update vehicle data from API
   */
  async updateVehicleData(options = {}) {
    const skipRefresh = options.skipRefresh || false;
    this.log(`Updating vehicle data (skipRefresh=${skipRefresh})`);

    try {
      // Get battery status
      const batteryData = await this.api.getBatteryStatus({ skipRefresh });
      
      if (batteryData.batteryPercent !== null) {
        await this.setCapabilityValue('measure_battery', batteryData.batteryPercent);
      }
      
      if (batteryData.rangeKm !== null) {
        await this.setCapabilityValue('measure_range', batteryData.rangeKm);
      }

      const isConnected = batteryData.isConnected || false;
      const isCharging = batteryData.isCharging || false;
      const chargePower = isCharging ? (batteryData.chargePowerKw || 0) : 0;
      await this.setCapabilityValue('measure_charge_power', chargePower);

      await this.setCapabilityValue('charging_status', isCharging);
      
      if (isCharging !== this.previousCharging) {
        const triggerCard = isCharging ? 'charging_started' : 'charging_stopped';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this, { battery: batteryData.batteryPercent || 0 })
          .catch(this.error);
        this.previousCharging = isCharging;
      }

      await this.setCapabilityValue('connected_status', isConnected);
      
      if (isConnected !== this.previousConnected) {
        const triggerCard = isConnected ? 'connected_to_charger' : 'disconnected_from_charger';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this)
          .catch(this.error);
        this.previousConnected = isConnected;
        this.checkAndUpdatePollingInterval(isConnected);
      }

      // Get HVAC status
      const hvacData = await this.api.getHvacStatus();
      
      if (hvacData.insideTempC !== null) {
        await this.setCapabilityValue('measure_temperature.inside', hvacData.insideTempC);
      }

      const climateOn = hvacData.on || false;
      await this.setCapabilityValue('onoff.climate', climateOn);
      
      if (climateOn !== this.previousClimateOn) {
        const triggerCard = climateOn ? 'climate_started' : 'climate_stopped';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this)
          .catch(this.error);
        this.previousClimateOn = climateOn;
      }

      // Handle persistent climate
      if (this.persistentClimateActive && !climateOn) {
        await this.handlePersistentClimateCheck();
      }

      // Get cockpit data
      try {
        const cockpitData = await this.api.getCockpit();
        if (cockpitData.odometerKm !== null) {
          await this.setCapabilityValue('measure_odometer', cockpitData.odometerKm);
        }
      } catch (cockpitError) {
        this.log('Failed to get cockpit data:', cockpitError.message);
      }

      // Get location data
      try {
        const locationData = await this.api.getLocation();
        
        if (locationData.lat !== null && locationData.lon !== null) {
          await this.setCapabilityValue('measure_latitude', locationData.lat);
          await this.setCapabilityValue('measure_longitude', locationData.lon);
          
          // Check for movement if persistent climate is active
          if (this.persistentClimateActive && this.lastKnownLocation) {
            const distance = this.calculateDistance(
              this.lastKnownLocation.lat,
              this.lastKnownLocation.lon,
              locationData.lat,
              locationData.lon
            );
            
            if (distance > 100) {
              this.log(`Vehicle moved ${Math.round(distance)}m, stopping persistent climate`);
              await this.stopPersistentClimate();
            }
          }
          
          this.lastKnownLocation = {
            lat: locationData.lat,
            lon: locationData.lon
          };
        }
      } catch (locationError) {
        this.log('Failed to get location data:', locationError.message);
      }

      this.setAvailable();
      this.log('Vehicle data updated successfully');
      
    } catch (error) {
      this.error('Failed to update vehicle data:', error);
      this.setUnavailable(error.message);
      throw error;
    }
  }

  /**
   * Handle persistent climate check - restart climate if needed
   */
  async handlePersistentClimateCheck() {
    if (this._deleted || !this.persistentClimateActive) return;

    const settings = this.getSettings();
    const maxMinutes = settings.persistent_climate_max_minutes || 30;
    const elapsedMs = Date.now() - this.persistentClimateStartTime;
    const elapsedMinutes = elapsedMs / (60 * 1000);

    if (elapsedMinutes >= maxMinutes) {
      this.log(`Persistent climate max time (${maxMinutes} min) exceeded, stopping`);
      await this.stopPersistentClimate();
      return;
    }

    this.log(`Persistent climate: HVAC stopped, restarting at ${this.persistentClimateTemperature}°C`);
    try {
      await this.homey.notifications.createNotification({ excerpt: 'Restarting climate control...' }).catch(this.error);
      await this.api.startClimateControl(this.persistentClimateTemperature);
    } catch (error) {
      this.error('Failed to restart persistent climate:', error);
      await this.setCapabilityValue('onoff.climate', false).catch(this.error);
    }
  }

  /**
   * Start persistent climate control
   */
  async startPersistentClimate(temperature) {
    this.log(`Starting persistent climate at ${temperature}°C`);
    
    this.persistentClimateActive = true;
    this.persistentClimateStartTime = Date.now();
    this.persistentClimateTemperature = temperature;
    
    // Store current location
    try {
      const locationData = await this.api.getLocation();
      if (locationData.lat !== null && locationData.lon !== null) {
        this.lastKnownLocation = {
          lat: locationData.lat,
          lon: locationData.lon
        };
      }
    } catch (error) {
      this.log('Could not get initial location for persistent climate:', error.message);
    }
    
    try {
      await this.homey.notifications.createNotification({ excerpt: 'Starting persistent climate control...' }).catch(this.error);
      const result = await this.api.startClimateControl(temperature);
      
      if (result) {
        await this.setCapabilityValue('target_temperature', temperature);
      }
      
      return result;
    } catch (error) {
      this.error('Failed to start persistent climate:', error);
      this.persistentClimateActive = false;
      await this.setCapabilityValue('onoff.climate', false).catch(this.error);
      throw error;
    }
  }

  /**
   * Stop persistent climate control
   */
  async stopPersistentClimate() {
    this.log('Stopping persistent climate');
    
    this.persistentClimateActive = false;
    this.persistentClimateStartTime = null;
    
    try {
      await this.homey.notifications.createNotification({ excerpt: 'Stopping persistent climate control...' }).catch(this.error);
      const result = await this.api.stopClimateControl();
      return result;
    } catch (error) {
      this.error('Failed to stop persistent climate:', error);
      await this.setCapabilityValue('onoff.climate', true).catch(this.error);
      throw error;
    }
  }

  /**
   * Action methods for flow cards
   */
  async startClimateControl(temperature) {
    const temp = Math.min(30, Math.max(16, Math.round(temperature)));
    this.log('Starting climate control at', temp, '°C');
    
    try {
      const result = await this.api.startClimateControl(temp);
      
      if (result) {
        await this.setCapabilityValue('target_temperature', temp);
      }
      
      return result;
    } catch (error) {
      this.error('Failed to start climate control:', error);
      throw error;
    }
  }

  async stopClimateControl() {
    this.log('Stopping climate control');
    
    if (this.persistentClimateActive) {
      this.persistentClimateActive = false;
      this.persistentClimateStartTime = null;
    }
    
    try {
      const result = await this.api.stopClimateControl();
      return result;
    } catch (error) {
      this.error('Failed to stop climate control:', error);
      throw error;
    }
  }

  /**
   * Manually refresh battery status
   */
  async refreshBatteryStatus() {
    this.log('Refreshing battery status (manual)');
    
    try {
      await this.setCapabilityValue('refreshing_status', true).catch(this.error);
      await this.api.startBackgroundRefresh();
      await this.updateVehicleData({ skipRefresh: true });
      return true;
    } catch (error) {
      this.error('Failed to start battery refresh:', error);
      await this.setCapabilityValue('refreshing_status', false).catch(this.error);
      throw error;
    }
  }

  /**
   * Refresh all vehicle data (blocking)
   */
  async refreshAllData() {
    this.log('Refreshing all vehicle data (blocking)...');
    
    await this.setCapabilityValue('refreshing_status', true).catch(this.error);
    
    try {
      const data = await this.api.refreshAllData();
      await this.populateFromData(data);
      
      await this.homey.flow.getDeviceTriggerCard('data_refreshed')
        .trigger(this, {
          battery: data.battery?.batteryPercent || 0,
          range: data.battery?.rangeKm || 0
        })
        .catch(this.error);
      
      this.log('All vehicle data refreshed successfully');
      return true;
      
    } catch (error) {
      this.error('Failed to refresh all data:', error);
      throw error;
    } finally {
      await this.setCapabilityValue('refreshing_status', false).catch(this.error);
    }
  }

  /**
   * Handle refresh all button press
   */
  async onRefreshAllButton(value) {
    if (!value) return;
    
    this.log('Refresh all button pressed');
    
    try {
      await this.homey.notifications.createNotification({ 
        excerpt: 'Refreshing vehicle data... This may take up to 90 seconds.' 
      }).catch(this.error);
      
      await this.refreshAllData();
      
      await this.homey.notifications.createNotification({ 
        excerpt: 'Vehicle data refreshed successfully' 
      }).catch(this.error);
    } catch (error) {
      this.error('Refresh all failed:', error);
      await this.homey.notifications.createNotification({ 
        excerpt: 'Failed to refresh vehicle data' 
      }).catch(this.error);
    } finally {
      await this.setCapabilityValue('button_refresh_all', false).catch(this.error);
    }
  }
}

module.exports = LeafZE1Device;
