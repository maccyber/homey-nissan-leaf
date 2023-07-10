'use strict';

const { Device } = require('homey');
const leafConnect = require('leaf-connect');

class LeafDevice extends Device {

  async onInit() {
    this.log('LeafDevice has been initialized');
    const [username, password, pollInterval, regionCode] = this.getSettings();
    this.updateCapabilities(username, password, regionCode);
    this.homey.setInterval(() => this.updateCapabilities(username, password, regionCode), pollInterval);
    this.registerCapabilityListener('onoff.climate_control', async (value) => {
      const client = await leafConnect({ username, password, regionCode });
      this.log(await client.climateControlStatus());
      return value;
    });
    this.registerCapabilityListener('onoff.charging', async (value) => {
      return false;
      // const client = await leafConnect({ username, password, regionCode });
    });
  }

  async updateCapabilities(username, password, regionCode) {
    try {
      const client = await leafConnect({ username, password, regionCode });
      this.log(client.sessionInfo());
      const status = await client.cachedStatus();
      const climateControlStatus = await client.climateControlStatus();
      this.log(climateControlStatus);
      const { BatteryStatusRecords: { BatteryStatus } } = status;
      this.log(BatteryStatus);
      this.setCapabilityValue('measure_battery', Number(BatteryStatus.SOC.Value)).catch(this.error);
      // BatteryStatus.PluginState
    } catch (error) {
      this.error(error);
    }
  }

}

module.exports = LeafDevice;
