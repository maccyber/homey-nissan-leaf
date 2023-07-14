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
      this.log(status);

      const climateControlStatus = await client.climateControlStatus();
      this.log(climateControlStatus);
      const racr = climateControlStatus.RemoteACRecords;
      const acIsRunning = racr.length > 0
        && racr.OperationResult !== null
        && racr.OperationResult.toString().startsWith('START')
        && racr.RemoteACOperation === 'START';
      this.setCapabilityValue('onoff.climate_control', acIsRunning);

      const { BatteryStatusRecords: { BatteryStatus, PluginState } } = status;

      const isCharging = BatteryStatus.BatteryChargingStatus !== 'NOT_CHARGING';
      const isConnected = PluginState !== 'NOT_CONNECTED';

      this.setCapabilityValue('measure_battery', Number(BatteryStatus.SOC.Value)).catch(this.error);
      this.setCapabilityValue('is_charging', isCharging).catch(this.error);
      this.setCapabilityValue('is_connected', isConnected).catch(this.error);
      this.setCapabilityValue('onoff.charging', isConnected && !isCharging).catch(this.error);
    } catch (error) {
      this.error(error);
    }
  }

}

module.exports = LeafDevice;
