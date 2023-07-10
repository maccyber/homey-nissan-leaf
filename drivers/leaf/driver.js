'use strict';

const { Driver } = require('homey');
const leafConnect = require('leaf-connect');

class LeafDriver extends Driver {

  async onInit() {
    this.log('LeafDriver has been initialized');
  }

  async onPair(session) {
    let username;
    let password;
    let client;
    let regionCode;
    let pollInterval;

    session.setHandler('validate', async (data) => {
      if (!data.username) throw Error('Enter username');
      if (!data.password) throw Error('Enter password');
      if (!data.regionCode) throw Error('Select region code');
      if (!data.pollInterval) throw Error('Enter poll interval');

      username = data.username;
      password = data.password;
      regionCode = data.regionCode;
      pollInterval = Number(data.pollInterval) * 1000;

      client = await leafConnect({
        username,
        password,
        regionCode,
      });

      const session = client.sessionInfo();
      this.log(session);

      return session.status === 200;
    });

    session.setHandler('list_devices', async () => {
      try {
        const session = client.sessionInfo();

        const { vehicle: { profile } } = session;

        return [
          {
            name: profile.nickname,
            data: {
              id: profile.vin,
            },
            capabilities: ['measure_battery', 'onoff.climate_control', 'onoff.charging'],
            settings: [
              username,
              password,
              pollInterval,
              regionCode,
            ],
          },
        ];
      } catch (error) {
        this.error(error);
        return [];
      }
    });
  }

}

module.exports = LeafDriver;
