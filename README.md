# Nissan Leaf for Homey

Control and monitor your Nissan Leaf electric vehicle from your Homey smart home hub.

## Supported Vehicles

| Model Years | Generation | Driver | API |
|-------------|------------|--------|-----|
| 2011-2017 | ZE0/AZE0 | `Nissan Leaf (Pre-2019)` | NissanConnect EV (legacy) |
| 2018 (early) | AZE0 | `Nissan Leaf (Pre-2019)` | NissanConnect EV (legacy) |
| 2018 (late) - 2024 | ZE1 | `Nissan Leaf (2019+)` | NissanConnect Services (Kamereon) |

> **Note**: The cutoff is approximately May 2019 for EU models. If unsure, try the 2019+ driver first - it will fail to find your vehicle if it's a legacy model.

## Features

### Both Drivers
- View battery state of charge (%)
- View estimated range
- Start/stop climate control (pre-conditioning)
- Start charging
- Check charging and connection status
- Flow cards for automation

### 2019+ Driver Additional Features
- Temperature-controlled climate (16-30°C)
- Persistent climate mode (auto-restarts until car moves or max time reached)
- GPS location tracking
- Odometer reading
- Charging power display (kW)
- Smart polling (faster updates while charging)

## Installation

1. Install the app from the Homey App Store
2. Add a device and select the appropriate driver for your vehicle
3. Enter your NissanConnect credentials
4. Select your region
5. If you have multiple vehicles, select the correct one

## Flow Cards

### Triggers (When...)
- Charging started
- Charging stopped
- Climate control started
- Climate control stopped
- Connected to charger
- Disconnected from charger
- Data refreshed (2019+ only)

### Conditions (And...)
- Charging
- Connected to charger
- Climate control is on
- Battery level is above X%

### Actions (Then...)
- Start charging
- Start climate control (with temperature for 2019+)
- Stop climate control
- Start persistent climate (2019+ only)
- Stop persistent climate (2019+ only)
- Refresh battery status
- Refresh all data (2019+ only)

## Capabilities

### Pre-2019 Driver
| Capability | Description |
|------------|-------------|
| `measure_battery` | Battery state of charge (%) |
| `measure_range` | Estimated range with A/C off (km) |
| `measure_range_ac_on` | Estimated range with A/C on (km) |
| `charging_status` | Current charging state |
| `connected_status` | Charger connection state |
| `onoff.climate` | Climate control on/off |

### 2019+ Driver
| Capability | Description |
|------------|-------------|
| `measure_battery` | Battery state of charge (%) |
| `measure_range` | Estimated range (km) |
| `charging_status` | Current charging state |
| `connected_status` | Charger connection state |
| `onoff.climate` | Climate control on/off |
| `target_temperature` | Climate target temperature (°C) |
| `measure_odometer` | Total distance driven (km) |
| `measure_charge_power` | Current charging power (kW) |
| `measure_latitude` | GPS latitude |
| `measure_longitude` | GPS longitude |

## Settings

### Pre-2019 Driver
- **Polling Interval**: How often to refresh data (minutes)

### 2019+ Driver
- **Normal Polling Interval**: Update frequency when idle (minutes)
- **Charging Polling Interval**: Update frequency while charging (minutes)
- **Persistent Climate Max Time**: Maximum duration for persistent climate (minutes)

## Regions

The app supports all NissanConnect regions:
- Europe
- USA
- Canada
- Japan
- Australia

## Upgrading from v1.x

If you're upgrading from version 1.x, your existing devices will automatically migrate to the new capability format. No action is required, but you may need to update any flows that reference the old capabilities.

### Capability Migration
| Old Capability | New Capability |
|----------------|----------------|
| `is_charging` | `charging_status` |
| `is_connected` | `connected_status` |
| `button_climate` | `onoff.climate` |
| `button_charging` | `button_start_charging` |
| `cruising_range_ac_off` | `measure_range` |
| `cruising_range_ac_on` | `measure_range_ac_on` |

## Troubleshooting

### "Invalid credentials" error
- Verify your NissanConnect username and password are correct
- Make sure you can log in to the NissanConnect app on your phone
- Check you've selected the correct region

### "Vehicle not found" error
- If using the 2019+ driver, try the Pre-2019 driver instead (or vice versa)
- Ensure your vehicle is registered in NissanConnect

### Data not updating
- Check your Homey's internet connection
- NissanConnect services may be temporarily unavailable
- Try manually refreshing using the refresh button

### Climate control not working
- The vehicle must be plugged in OR have sufficient battery
- There may be a cooldown period between climate commands
- Check if climate is already running

## Local Development

Prerequisites:
- [Node.js and NPM](https://nodejs.org/en/download)
- [git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started)

```sh
# Clone the repository
git clone https://github.com/RonnyWinkler/homey-nissan-leaf.git
cd homey-nissan-leaf

# Install dependencies
npm install

# Run on your Homey (development mode)
homey app run

# Build for production
homey app build

# Lint the code
npm run lint-fix
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint-fix`
5. Submit a pull request

## Credits

- Original app by [RonnyWinkler](https://github.com/RonnyWinkler)
- 2019+ Nissan Leaf support based on work by [Moweezy](https://github.com/Moweezy/com.nissan.connect.new)
- Uses [leaf-connect](https://www.npmjs.com/package/leaf-connect) for legacy API

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This app is not affiliated with, endorsed by, or connected to Nissan Motor Corporation. Use at your own risk.
