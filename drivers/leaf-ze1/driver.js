'use strict';

const Homey = require('homey');
const NissanConnectAPI = require('../../lib/NissanConnectAPI');

class LeafZE1Driver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Nissan Leaf (2019+) driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' template is used
   */
  async onPairListDevices(credentials) {
    if (!credentials || !credentials.api) {
      throw new Error('No login session found');
    }

    try {
      // Get session which includes VIN discovery
      const apiSession = await credentials.api.getSession();
      
      return [
        {
          name: `Nissan Leaf (${apiSession.vin.substring(apiSession.vin.length - 6)})`,
          data: {
            id: apiSession.vin
          },
          settings: {
            vin: apiSession.vin,
            polling_interval_idle: 60,
            polling_interval_charging: 10,
            persistent_climate_max_minutes: 30
          },
          store: {
            username: credentials.username,
            password: credentials.password
          }
        }
      ];
    } catch (error) {
      this.error('Error listing devices:', error);
      throw new Error('Failed to discover vehicle. Please check your credentials.');
    }
  }

  /**
   * onPair is called when a user starts pairing
   */
  async onPair(session) {
    // Session-scoped credentials (not global) to prevent credential leakage
    // between concurrent pairing sessions
    let credentials = null;
    let backgroundFetchPromise = null;
    let fetchedData = null;
    let selectedDevice = null; // Track the device selected by user in list_devices
    
    // Handshake mechanism to prevent race condition:
    // View emits 'view_ready' when it's listening, then we emit 'proceed'
    let viewReadyResolve = null;
    const viewReadyPromise = new Promise(resolve => { viewReadyResolve = resolve; });
    
    session.setHandler('view_ready', async () => {
      this.log('View ready signal received');
      viewReadyResolve();
    });

    session.setHandler('login', async (data) => {
      const { username, password } = data;

      try {
        // Test the credentials by creating API instance and getting session
        const api = new NissanConnectAPI(username, password);
        await api.getSession();
        
        credentials = {
          username,
          password,
          api
        };

        return true;
      } catch (error) {
        this.error('Login failed:', error);
        throw new Error('Login failed. Please check your Nissan Connect credentials.');
      }
    });

    session.setHandler('list_devices', async () => {
      // Quick VIN discovery
      const devices = await this.onPairListDevices(credentials);
      
      // Store the first device (we only support one vehicle per account for now)
      // This will be used when creating the device in add_devices view
      selectedDevice = devices[0];
      
      // Start background fetch immediately after discovering devices (don't await)
      this.log('Starting background vehicle data fetch...');
      backgroundFetchPromise = this.fetchInitialVehicleData(credentials.api)
        .then(result => {
          fetchedData = result.essential;
          this.log('Essential data ready, optional fetch continues in background');
          // Optional data continues to populate fetchedData via mutation
        })
        .catch(err => {
          this.log('Background fetch failed:', err.message);
        });
      
      return devices;
    });

    // Handle showView event for add_devices
    session.setHandler('showView', async (view) => {
      if (view === 'add_devices') {
        // Wait for BOTH: view ready (listener registered) AND data ready
        // This prevents race condition where we emit 'proceed' before view is listening
        this.log('Waiting for view ready and essential data...');
        
        try {
          const dataPromise = backgroundFetchPromise 
            ? Promise.race([
                backgroundFetchPromise,
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Fetch timeout after 90 seconds')), 90000)
                )
              ])
            : Promise.resolve();
          
          // Wait for both promises - order doesn't matter
          await Promise.all([viewReadyPromise, dataPromise]);
          this.log('Both view and data ready');
        } catch (e) {
          this.log('Wait ended:', e.message);
          // Still wait for view to be ready even if data fetch failed/timed out
          await viewReadyPromise;
        }
        
        // Attach fetched data to device store before sending to view
        if (selectedDevice && fetchedData) {
          selectedDevice.store = selectedDevice.store || {};
          selectedDevice.store.initialData = fetchedData;
          this.log('Initial data attached to device');
        }
        
        // Signal the view with the device data so it can call Homey.createDevice()
        // Safe to emit now - view is guaranteed to be listening
        this.log('Emitting proceed with device data');
        session.emit('proceed', selectedDevice);
      }
    });
  }

  /**
   * Fetch essential vehicle data during pairing
   */
  async fetchInitialVehicleData(api) {
    const data = {};

    // Battery status (with refresh - wakes up the car)
    this.log('Fetching battery status (with refresh)...');
    try {
      data.battery = await api.getBatteryStatus({ skipRefresh: false });
      this.log('Battery:', data.battery.batteryPercent + '%', data.battery.rangeKm + 'km');
    } catch (e) {
      this.log('Battery fetch failed:', e.message);
    }

    // Climate/HVAC status
    this.log('Fetching HVAC status...');
    try {
      data.hvac = await api.getHvacStatus();
      this.log('HVAC on:', data.hvac.on, 'temp:', data.hvac.insideTempC);
    } catch (e) {
      this.log('HVAC fetch failed:', e.message);
    }

    this.log('Essential data fetch complete');

    // Fire-and-forget: Odometer + Location
    this.fetchOptionalVehicleData(api, data);

    return { essential: data };
  }

  /**
   * Fetch optional vehicle data (odometer, location)
   */
  async fetchOptionalVehicleData(api, data) {
    this.log('Fetching odometer...');
    try {
      data.cockpit = await api.getCockpit();
      this.log('Odometer:', data.cockpit.odometerKm + 'km');
    } catch (e) {
      this.log('Cockpit fetch failed:', e.message);
    }

    this.log('Fetching location...');
    try {
      data.location = await api.getLocation();
      this.log('Location:', data.location.lat, data.location.lon);
    } catch (e) {
      this.log('Location fetch failed:', e.message);
    }

    this.log('Optional data fetch complete');
  }
}

module.exports = LeafZE1Driver;
