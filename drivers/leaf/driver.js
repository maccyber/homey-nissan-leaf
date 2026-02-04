'use strict';

const Homey = require('homey');
const NissanLegacyAPI = require('../../lib/NissanLegacyAPI');

class LeafDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Nissan Leaf (pre-2019) driver has been initialized');
  }

  /**
   * onPair is called when a user starts pairing
   */
  async onPair(session) {
    let credentials = null;

    // Handle validation from custom pairing page
    session.setHandler('validate', async (data) => {
      const { username, password, regionCode, pollInterval } = data;

      if (!username || !password) {
        throw new Error('Username and password are required');
      }

      try {
        this.log('Validating credentials for region:', regionCode);
        
        // Test the credentials
        const api = new NissanLegacyAPI(username, password, regionCode || 'NE');
        const sessionInfo = await api.getSession();
        
        if (sessionInfo.status !== 200) {
          throw new Error('Authentication failed');
        }

        // Store credentials for later use
        credentials = {
          username,
          password,
          regionCode: regionCode || 'NE',
          pollInterval: pollInterval || 240,
          api
        };

        this.log('Credentials validated successfully');
        return true;
        
      } catch (error) {
        this.error('Validation failed:', error);
        throw new Error('Login failed. Please check your credentials.');
      }
    });

    session.setHandler('list_devices', async () => {
      if (!credentials) {
        throw new Error('Please validate your credentials first');
      }

      try {
        const vehicles = await credentials.api.getVehicles();
        
        if (!vehicles || vehicles.length === 0) {
          throw new Error('No vehicles found on this account');
        }

        this.log(`Found ${vehicles.length} vehicle(s)`);

        return vehicles.map(vehicle => {
          const vin = vehicle.vin || vehicle.custom_sessionid;
          const nickname = vehicle.nickname || `Nissan Leaf (${vin ? vin.substring(vin.length - 6) : 'Unknown'})`;
          
          return {
            name: nickname,
            data: {
              id: vin
            },
            settings: {
              username: credentials.username,
              password: credentials.password,
              regionCode: credentials.regionCode,
              pollInterval: credentials.pollInterval
            }
          };
        });
        
      } catch (error) {
        this.error('Error listing devices:', error);
        throw new Error('Failed to discover vehicles. Please try again.');
      }
    });
  }
}

module.exports = LeafDriver;
