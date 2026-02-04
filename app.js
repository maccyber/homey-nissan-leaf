'use strict';

const Homey = require('homey');

class LeafApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Nissan Leaf app v2.0 has been initialized');

    // Register flow card handlers
    await this._registerFlowCards();
  }

  /**
   * Register all flow card handlers
   */
  async _registerFlowCards() {
    // ==================== CONDITIONS ====================

    // Condition: Is charging
    this.homey.flow.getConditionCard('is_charging')
      .registerRunListener(async (args) => {
        const { device } = args;
        return device.getCapabilityValue('charging_status') === true;
      });

    // Condition: Is connected to charger
    this.homey.flow.getConditionCard('is_connected')
      .registerRunListener(async (args) => {
        const { device } = args;
        return device.getCapabilityValue('connected_status') === true;
      });

    // Condition: Climate is on
    this.homey.flow.getConditionCard('climate_is_on')
      .registerRunListener(async (args) => {
        const { device } = args;
        return device.getCapabilityValue('onoff.climate') === true;
      });

    // Condition: Battery above percentage
    this.homey.flow.getConditionCard('battery_above')
      .registerRunListener(async (args) => {
        const { device, percentage } = args;
        const battery = device.getCapabilityValue('measure_battery');
        return battery > percentage;
      });

    // ==================== ACTIONS ====================

    // Action: Start climate control (with temperature - 2019+ models only)
    this.homey.flow.getActionCard('start_climate')
      .registerRunListener(async (args) => {
        const { device, temperature } = args;
        if (typeof device.startClimateControl === 'function') {
          await device.startClimateControl(temperature);
        } else {
          throw new Error('This device does not support temperature-controlled climate');
        }
      });

    // Action: Start climate control (without temperature - pre-2019 models)
    this.homey.flow.getActionCard('start_climate_legacy')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.startClimate === 'function') {
          await device.startClimate();
        } else {
          throw new Error('This device does not support this action');
        }
      });

    // Action: Stop climate control
    this.homey.flow.getActionCard('stop_climate')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.stopClimateControl === 'function') {
          await device.stopClimateControl();
        } else if (typeof device.stopClimate === 'function') {
          await device.stopClimate();
        } else {
          throw new Error('This device does not support climate control');
        }
      });

    // Action: Refresh battery status (2019+ models only)
    this.homey.flow.getActionCard('refresh_battery')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.refreshBatteryStatus === 'function') {
          await device.refreshBatteryStatus();
        } else {
          throw new Error('This device does not support battery refresh');
        }
      });

    // Action: Start persistent climate (2019+ models only)
    this.homey.flow.getActionCard('start_persistent_climate')
      .registerRunListener(async (args) => {
        const { device, temperature } = args;
        if (typeof device.startPersistentClimate === 'function') {
          await device.startPersistentClimate(temperature);
        } else {
          throw new Error('This device does not support persistent climate');
        }
      });

    // Action: Stop persistent climate (2019+ models only)
    this.homey.flow.getActionCard('stop_persistent_climate')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.stopPersistentClimate === 'function') {
          await device.stopPersistentClimate();
        } else {
          throw new Error('This device does not support persistent climate');
        }
      });

    // Action: Start charging (pre-2019 models only)
    this.homey.flow.getActionCard('start_charging')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.startCharging === 'function') {
          await device.startCharging();
        } else {
          throw new Error('This device does not support start charging command');
        }
      });

    // Action: Refresh all vehicle data (both models)
    this.homey.flow.getActionCard('refresh_all_data')
      .registerRunListener(async (args) => {
        const { device } = args;
        if (typeof device.refreshAllData === 'function') {
          await device.refreshAllData();
        } else {
          throw new Error('This device does not support refresh all data');
        }
      });

    this.log('Flow cards registered successfully');
  }

}

module.exports = LeafApp;
