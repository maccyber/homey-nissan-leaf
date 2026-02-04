'use strict';

const Homey = require('homey');
const NissanLegacyAPI = require('../../lib/NissanLegacyAPI');

class LeafDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Nissan Leaf (pre-2019) device has been initialized');

    // Get stored settings
    const settings = this.getSettings();
    
    // Initialize API
    this.api = new NissanLegacyAPI(
      settings.username,
      settings.password,
      settings.regionCode || 'NE'
    );

    // Track previous states for triggers
    this.previousCharging = false;
    this.previousConnected = false;
    this.previousClimateOn = false;

    // Migrate capabilities for existing devices (must happen before registering listeners)
    await this.migrateCapabilities();

    // Register capability listeners
    this.registerCapabilityListener('onoff.climate', this.onClimateCapability.bind(this));
    this.registerCapabilityListener('button_start_charging', this.onStartChargingCapability.bind(this));
    this.registerCapabilityListener('button_refresh_all', this.onRefreshAllButton.bind(this));

    // Initialize refreshing status
    await this.setCapabilityValue('refreshing_status', false).catch(this.error);

    // Start polling
    const pollInterval = (settings.pollInterval || 240) * 1000;
    this.log(`Starting polling every ${settings.pollInterval || 240} seconds`);
    
    this.pollingInterval = this.homey.setInterval(
      () => this.updateVehicleData(),
      pollInterval
    );

    // Initial data fetch
    await this.updateVehicleData();
  }

  /**
   * onSettings is called when the user updates settings
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    // Restart polling if interval changed
    if (changedKeys.includes('pollInterval')) {
      this.stopPolling();
      const pollInterval = (newSettings.pollInterval || 240) * 1000;
      this.pollingInterval = this.homey.setInterval(
        () => this.updateVehicleData(),
        pollInterval
      );
      this.log(`Polling interval changed to ${newSettings.pollInterval} seconds`);
    }

    // Reinitialize API if credentials changed
    if (changedKeys.includes('username') || changedKeys.includes('password') || changedKeys.includes('regionCode')) {
      this.api = new NissanLegacyAPI(
        newSettings.username,
        newSettings.password,
        newSettings.regionCode || 'NE'
      );
      this.log('API reinitialized with new credentials');
      await this.updateVehicleData();
    }
  }

  /**
   * onDeleted is called when the user deletes the device
   */
  async onDeleted() {
    this.log('Nissan Leaf device has been deleted');
    this.stopPolling();
  }

  /**
   * Stop polling interval
   */
  stopPolling() {
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.log('Polling stopped');
    }
  }

  /**
   * Migrate capabilities for existing devices when app is updated
   * This is critical for preserving existing devices when upgrading from v1.x to v2.x
   */
  async migrateCapabilities() {
    this.log('Checking capability migration...');
    
    // Define capability migrations: old capability -> new capability
    const migrations = [
      { old: 'is_charging', new: 'charging_status' },
      { old: 'is_connected', new: 'connected_status' },
      { old: 'button_climate', new: 'onoff.climate' },
      { old: 'button_charging', new: 'button_start_charging' },
      { old: 'cruising_range_ac_off', new: 'measure_range' },
      { old: 'cruising_range_ac_on', new: 'measure_range_ac_on' }
    ];

    // Perform migrations
    for (const migration of migrations) {
      if (this.hasCapability(migration.old)) {
        this.log(`Migrating capability: ${migration.old} -> ${migration.new}`);
        
        // Get old value before removing
        let oldValue = null;
        try {
          oldValue = this.getCapabilityValue(migration.old);
        } catch (e) {
          this.log(`Could not get value for ${migration.old}`);
        }
        
        // Remove old capability
        await this.removeCapability(migration.old).catch(this.error);
        
        // Add new capability if not present
        if (!this.hasCapability(migration.new)) {
          await this.addCapability(migration.new).catch(this.error);
        }
        
        // Set the old value on the new capability if we had one
        if (oldValue !== null) {
          await this.setCapabilityValue(migration.new, oldValue).catch(this.error);
        }
      }
    }

    // Ensure all required capabilities exist
    const requiredCapabilities = [
      'measure_battery',
      'measure_range',
      'measure_range_ac_on',
      'charging_status',
      'connected_status',
      'refreshing_status',
      'onoff.climate',
      'button_start_charging',
      'button_refresh_all',
      'measure_latitude',
      'measure_longitude'
    ];

    for (const capability of requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        this.log(`Adding missing capability: ${capability}`);
        await this.addCapability(capability).catch(this.error);
      }
    }

    this.log('Capability migration complete');
  }

  /**
   * Handle climate on/off toggle
   */
  async onClimateCapability(value) {
    this.log('Climate control toggled:', value);

    try {
      if (value) {
        await this.homey.notifications.createNotification({ excerpt: 'Starting climate control...' }).catch(this.error);
        await this.api.startClimate();
        await this.homey.notifications.createNotification({ excerpt: 'Climate control started' }).catch(this.error);
        
        // Trigger flow
        await this.homey.flow.getDeviceTriggerCard('climate_started')
          .trigger(this)
          .catch(this.error);
      } else {
        await this.homey.notifications.createNotification({ excerpt: 'Stopping climate control...' }).catch(this.error);
        await this.api.stopClimate();
        await this.homey.notifications.createNotification({ excerpt: 'Climate control stopped' }).catch(this.error);
        
        // Trigger flow
        await this.homey.flow.getDeviceTriggerCard('climate_stopped')
          .trigger(this)
          .catch(this.error);
      }
    } catch (error) {
      this.error('Climate control error:', error);
      // Revert state on error
      await this.setCapabilityValue('onoff.climate', !value).catch(this.error);
      throw error;
    }
  }

  /**
   * Handle start charging button
   */
  async onStartChargingCapability(value) {
    if (!value) return; // Only act on button press (true)

    this.log('Start charging requested');

    try {
      await this.homey.notifications.createNotification({ excerpt: 'Starting charging...' }).catch(this.error);
      await this.api.startCharging();
      await this.homey.notifications.createNotification({ excerpt: 'Charging command sent' }).catch(this.error);
      
      // Reset button state
      await this.setCapabilityValue('button_start_charging', false).catch(this.error);
      
      // Refresh status after a delay
      setTimeout(() => this.updateVehicleData(), 30000);
    } catch (error) {
      this.error('Start charging error:', error);
      await this.setCapabilityValue('button_start_charging', false).catch(this.error);
      throw error;
    }
  }

  /**
   * Update vehicle data from API
   */
  async updateVehicleData() {
    this.log('Updating vehicle data...');

    try {
      // Get battery status
      const battery = await this.api.getBatteryStatus();
      
      if (battery.batteryPercent !== null) {
        await this.setCapabilityValue('measure_battery', battery.batteryPercent).catch(this.error);
      }
      
      if (battery.rangeKm !== null) {
        await this.setCapabilityValue('measure_range', battery.rangeKm).catch(this.error);
      }
      
      if (battery.rangeAcOnKm !== null) {
        await this.setCapabilityValue('measure_range_ac_on', battery.rangeAcOnKm).catch(this.error);
      }

      // Update charging status with trigger
      const isCharging = battery.isCharging || false;
      await this.setCapabilityValue('charging_status', isCharging).catch(this.error);
      
      if (isCharging !== this.previousCharging) {
        const triggerCard = isCharging ? 'charging_started' : 'charging_stopped';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this, { battery: battery.batteryPercent || 0 })
          .catch(this.error);
        this.previousCharging = isCharging;
      }

      // Update connected status with trigger
      const isConnected = battery.isConnected || false;
      await this.setCapabilityValue('connected_status', isConnected).catch(this.error);
      
      if (isConnected !== this.previousConnected) {
        const triggerCard = isConnected ? 'connected_to_charger' : 'disconnected_from_charger';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this)
          .catch(this.error);
        this.previousConnected = isConnected;
      }

      // Get climate status
      const climate = await this.api.getClimateStatus();
      const climateOn = climate.on || false;
      await this.setCapabilityValue('onoff.climate', climateOn).catch(this.error);
      
      if (climateOn !== this.previousClimateOn) {
        const triggerCard = climateOn ? 'climate_started' : 'climate_stopped';
        await this.homey.flow.getDeviceTriggerCard(triggerCard)
          .trigger(this)
          .catch(this.error);
        this.previousClimateOn = climateOn;
      }

      // Get location (optional, may fail)
      try {
        const location = await this.api.getLocation();
        if (location.lat !== null && location.lon !== null) {
          await this.setCapabilityValue('measure_latitude', location.lat).catch(this.error);
          await this.setCapabilityValue('measure_longitude', location.lon).catch(this.error);
        }
      } catch (e) {
        this.log('Location fetch failed (optional):', e.message);
      }

      this.setAvailable();
      this.log('Vehicle data updated successfully');
      
    } catch (error) {
      this.error('Failed to update vehicle data:', error);
      this.setUnavailable(error.message);
    }
  }

  /**
   * Flow action: Start climate (no temperature for legacy)
   */
  async startClimate() {
    this.log('Starting climate control (flow action)');
    await this.api.startClimate();
    await this.setCapabilityValue('onoff.climate', true).catch(this.error);
  }

  /**
   * Flow action: Stop climate
   */
  async stopClimate() {
    this.log('Stopping climate control (flow action)');
    await this.api.stopClimate();
    await this.setCapabilityValue('onoff.climate', false).catch(this.error);
  }

  /**
   * Flow action: Start charging
   */
  async startCharging() {
    this.log('Starting charging (flow action)');
    await this.api.startCharging();
  }

  /**
   * Refresh all vehicle data (blocking)
   * Wakes the car, fetches battery, climate, and location
   * Updates all capabilities and triggers data_refreshed flow
   */
  async refreshAllData() {
    this.log('Refreshing all vehicle data (blocking)...');
    
    // Set refreshing indicator
    await this.setCapabilityValue('refreshing_status', true).catch(this.error);
    
    try {
      // Call API to refresh all data (blocking - wakes the car)
      const data = await this.api.refreshAllData();
      
      // Update battery capabilities
      if (data.battery) {
        const b = data.battery;
        if (b.batteryPercent !== null) {
          await this.setCapabilityValue('measure_battery', b.batteryPercent).catch(this.error);
        }
        if (b.rangeKm !== null) {
          await this.setCapabilityValue('measure_range', b.rangeKm).catch(this.error);
        }
        if (b.rangeAcOnKm !== null) {
          await this.setCapabilityValue('measure_range_ac_on', b.rangeAcOnKm).catch(this.error);
        }
        
        const isCharging = b.isCharging || false;
        const isConnected = b.isConnected || false;
        await this.setCapabilityValue('charging_status', isCharging).catch(this.error);
        await this.setCapabilityValue('connected_status', isConnected).catch(this.error);
      }
      
      // Update climate status
      if (data.climate) {
        const climateOn = data.climate.on || false;
        await this.setCapabilityValue('onoff.climate', climateOn).catch(this.error);
      }
      
      // Update location
      if (data.location && data.location.lat !== null && data.location.lon !== null) {
        await this.setCapabilityValue('measure_latitude', data.location.lat).catch(this.error);
        await this.setCapabilityValue('measure_longitude', data.location.lon).catch(this.error);
      }
      
      // Trigger data_refreshed flow card
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
    if (!value) return; // Only act on button press (true)
    
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
      // Reset button state
      await this.setCapabilityValue('button_refresh_all', false).catch(this.error);
    }
  }
}

module.exports = LeafDevice;
