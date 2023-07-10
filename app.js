'use strict';

const Homey = require('homey');

class LeafApp extends Homey.App {

  async onInit() {
    this.log('LeafApp has been initialized');
  }

}

module.exports = LeafApp;
