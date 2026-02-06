# Nissan Leaf Homey App - Merge Session Notes

> **Purpose**: This document captures the complete merge process for adding 2019+ Nissan Leaf support. Use this to continue work in a new session or understand what was changed.

## Quick Status

| Item | Status |
|------|--------|
| Merge Complete | ✅ Yes |
| Build Passes | ✅ Yes |
| Committed | ✅ Yes (526a427) |
| Pushed to Remote | ❌ No |
| Tested on Device | ❌ No |

## Repository Locations

```
Target (main repo):  C:\github\homey-nissan-leaf\
Source (reference):  C:\github\com.nissan.connect.new\
```

## Project Overview

**Goal**: Merge two Homey apps for Nissan Leaf vehicles:
- **Target**: `homey-nissan-leaf` (app ID: `com.nissan.leaf`) - existing app with users
- **Source**: `com.nissan.connect.new` (app ID: `com.nissan.connect.beta`) - new 2019+ functionality

**Critical Requirement**: App ID must remain `com.nissan.leaf` to preserve existing user devices and settings.

---

## What Was Done (10 Phases)

### Phase 1: Dependencies & Libraries ✅

**Files Modified:**
- `package.json` - Updated to version 2.0.0, added new dependencies

**Files Created:**
- `lib/NissanConnectAPI.js` - Kamereon OAuth2 API for 2019+ vehicles
- `lib/NissanLegacyAPI.js` - Wrapper around leaf-connect for pre-2019 vehicles  
- `lib/constants.js` - Shared constants (regions, status codes, temperature limits)
- `lib/errors.js` - Custom error classes (NissanAPIError, AuthenticationError, VehicleNotFoundError)
- `lib/mappers.js` - Data transformation functions

**New Dependencies Added:**
```json
"axios": "^1.6.0",
"axios-cookiejar-support": "^4.0.7",
"tough-cookie": "^4.1.3"
```

**Key Decisions:**
- Created abstraction layer (`lib/`) to share code between drivers
- NissanLegacyAPI wraps leaf-connect to provide consistent interface
- NissanConnectAPI implements Kamereon OAuth2 from scratch (copied from source app)

### Phase 2: App Metadata ✅

**Files Modified:**
- `.homeycompose/app.json`

**Changes:**
- Version: 1.0.23 → 2.0.0
- Updated description mentioning both vehicle generations
- Added new tags: "nissan connect", "kamereon", "ze1"
- Added `xlarge.png` support
- Added contributors section

### Phase 3: New Capabilities ✅

**Files Created in `.homeycompose/capabilities/`:**

| File | Purpose |
|------|---------|
| `charging_status.json` | Enum: not_charging, charging, etc. |
| `connected_status.json` | Enum: disconnected, connected |
| `measure_range.json` | Range in km (replaces cruising_range_ac_off) |
| `measure_range_ac_on.json` | Range with A/C in km |
| `refreshing_status.json` | Boolean: data refresh in progress |
| `button_start_charging.json` | Button to start charging |
| `button_refresh_all.json` | Button to refresh all data |
| `measure_odometer.json` | Odometer reading in km |
| `measure_charge_power.json` | Charging power in kW |
| `measure_latitude.json` | GPS latitude |
| `measure_longitude.json` | GPS longitude |

**Old Capabilities Kept (for migration):**
- `is_charging.json`, `is_connected.json`
- `button_climate.json`, `button_charging.json`
- `cruising_range_ac_on.json`, `cruising_range_ac_off.json`

### Phase 4: Flow Cards ✅

**Files Created in `.homeycompose/flow/`:**

**Triggers (7):**
- `triggers/charging_started.json`
- `triggers/charging_stopped.json`
- `triggers/climate_started.json`
- `triggers/climate_stopped.json`
- `triggers/connected_to_charger.json`
- `triggers/disconnected_from_charger.json`
- `triggers/data_refreshed.json`

**Conditions (4):**
- `conditions/is_charging.json`
- `conditions/is_connected.json`
- `conditions/climate_is_on.json`
- `conditions/battery_above.json`

**Actions (8):**
- `actions/start_charging.json`
- `actions/start_climate.json` (2019+ with temperature)
- `actions/start_climate_legacy.json` (pre-2019)
- `actions/stop_climate.json`
- `actions/start_persistent_climate.json`
- `actions/stop_persistent_climate.json`
- `actions/refresh_battery.json`
- `actions/refresh_all_data.json`

### Phase 5: App.js ✅

**Files Modified:**
- `app.js`

**Changes:**
- Added flow card handler registration in `onInit()`
- Condition handlers: `is_charging`, `is_connected`, `climate_is_on`, `battery_above`
- Action handlers: All 8 actions with proper device method calls

### Phase 6: Updated Existing `leaf` Driver ✅

**Files Modified:**
- `drivers/leaf/driver.compose.json` - New capabilities and settings
- `drivers/leaf/device.js` - Complete rewrite with migration logic
- `drivers/leaf/driver.js` - Updated to use NissanLegacyAPI

**Capability Migration Logic (in device.js):**
```javascript
const migrations = [
  { old: 'is_charging', new: 'charging_status' },
  { old: 'is_connected', new: 'connected_status' },
  { old: 'button_climate', new: 'onoff.climate' },
  { old: 'button_charging', new: 'button_start_charging' },
  { old: 'cruising_range_ac_off', new: 'measure_range' },
  { old: 'cruising_range_ac_on', new: 'measure_range_ac_on' },
];
```

**Key Implementation Details:**
- Uses NissanLegacyAPI (wraps leaf-connect)
- Polling interval configurable via settings
- Graceful error handling with user-friendly messages

### Phase 7: New `leaf-ze1` Driver ✅

**Files Created:**
- `drivers/leaf-ze1/driver.compose.json`
- `drivers/leaf-ze1/driver.js`
- `drivers/leaf-ze1/device.js`
- `drivers/leaf-ze1/pair/add_devices.html`
- `drivers/leaf-ze1/assets/images/small.png`
- `drivers/leaf-ze1/assets/images/large.png`

**Key Features:**
- NissanConnectAPI (Kamereon OAuth2)
- Temperature-controlled climate (16-30°C)
- Persistent climate mode (auto-restarts)
- Smart polling (different intervals for idle vs charging)
- GPS location tracking
- Odometer and charging power display

**Pairing Flow:**
1. User enters credentials + region
2. Background fetch of vehicles during "loading" screen
3. Display available vehicles for selection
4. Store credentials and VIN in device data

### Phase 8: Locales ✅

**Files Modified:**
- `locales/en.json`
- `locales/no.json`

**Added Translations For:**
- Both driver names and descriptions
- All capability titles and values
- All flow card titles and descriptions
- Settings labels and hints
- Error messages

### Phase 9: Assets ✅

**Files Created:**
- `assets/refresh.svg`
- `assets/odometer.svg`
- `assets/range.svg`
- `assets/plug.svg`
- `assets/climate.svg`
- `assets/images/xlarge.png`

**Files Modified:**
- `assets/charging.svg` - Simplified design

### Phase 10: Build & Commit ✅

**Commands Run:**
```bash
npm install
npx homey app build
git add -A
git commit -m "feat: Add support for 2019+ Nissan Leaf (ZE1) vehicles"
```

**Build Output:**
- 2 drivers registered (leaf, leaf-ze1)
- 19 flow cards registered
- All capabilities validated
- No errors at debug level

---

## File Change Summary

### New Files (39)
```
lib/
├── NissanConnectAPI.js
├── NissanLegacyAPI.js
├── constants.js
├── errors.js
└── mappers.js

drivers/leaf-ze1/
├── driver.compose.json
├── driver.js
├── device.js
├── pair/add_devices.html
└── assets/images/{small,large}.png

.homeycompose/capabilities/
├── charging_status.json
├── connected_status.json
├── measure_range.json
├── measure_range_ac_on.json
├── refreshing_status.json
├── button_start_charging.json
├── button_refresh_all.json
├── measure_odometer.json
├── measure_charge_power.json
├── measure_latitude.json
└── measure_longitude.json

.homeycompose/flow/triggers/
├── charging_started.json
├── charging_stopped.json
├── climate_started.json
├── climate_stopped.json
├── connected_to_charger.json
├── disconnected_from_charger.json
└── data_refreshed.json

.homeycompose/flow/conditions/
├── is_charging.json
├── is_connected.json
├── climate_is_on.json
└── battery_above.json

.homeycompose/flow/actions/
├── start_charging.json
├── start_climate.json
├── start_climate_legacy.json
├── stop_climate.json
├── start_persistent_climate.json
├── stop_persistent_climate.json
├── refresh_battery.json
└── refresh_all_data.json

assets/
├── refresh.svg
├── odometer.svg
├── range.svg
├── plug.svg
├── climate.svg
└── images/xlarge.png
```

### Modified Files (20)
```
package.json
package-lock.json
app.js
.homeycompose/app.json
drivers/leaf/driver.compose.json
drivers/leaf/driver.js
drivers/leaf/device.js
locales/en.json
locales/no.json
assets/charging.svg
+ Various generated files in .homeycompose/
```

---

## Technical Decisions & Rationale

### 1. Two Separate Drivers
**Decision**: Create `leaf` (pre-2019) and `leaf-ze1` (2019+) as separate drivers.
**Rationale**: 
- Different APIs with different capabilities
- Users select correct driver during pairing
- Cleaner code separation
- Existing devices continue working

### 2. Capability Migration
**Decision**: Automatically migrate old capabilities to new ones on device init.
**Rationale**:
- Existing users get new features without re-pairing
- Old flows may break but device still works
- Migration is one-way and transparent

### 3. Shared Library Layer
**Decision**: Create `lib/` folder with shared code.
**Rationale**:
- Consistent API interface for both drivers
- Shared constants and error handling
- Easier maintenance

### 4. Persistent Climate Feature
**Decision**: Implement as device-level feature with configurable max time.
**Rationale**:
- Nissan only allows 10-15 min climate sessions
- Users want pre-conditioning for longer periods
- Auto-restart when climate stops (checks if car hasn't moved)

### 5. Smart Polling
**Decision**: Different polling intervals for idle vs charging states.
**Rationale**:
- Faster updates important during charging
- Reduces API calls and battery when idle
- User-configurable intervals

---

## Known Issues & Limitations

### 1. Nissan API Reliability
- Nissan's servers can be slow or unresponsive
- Commands may take 30-60 seconds to execute
- Status may not update immediately after commands

### 2. Legacy API Limitations
- No GPS support for pre-2019 vehicles
- No odometer reading
- No charging power display
- Climate is on/off only (no temperature control)

### 3. Regional Differences
- Some features may not be available in all regions
- API endpoints differ by region
- Testing only done with European accounts

### 4. Pairing UX
- If credentials are wrong, error may not be clear
- Vehicle selection requires valid API response
- No way to test credentials before saving

---

## Testing Checklist

Before publishing, test the following:

### Pre-2019 Driver (`leaf`)
- [ ] Pairing with valid credentials
- [ ] Pairing error with invalid credentials
- [ ] Battery status refresh
- [ ] Start/stop climate control
- [ ] Start charging
- [ ] Flow triggers fire correctly
- [ ] Capability migration from v1.x

### 2019+ Driver (`leaf-ze1`)
- [ ] Pairing with valid credentials
- [ ] Vehicle selection with multiple vehicles
- [ ] Battery status refresh
- [ ] Climate with temperature control
- [ ] Persistent climate mode
- [ ] GPS location update
- [ ] Charging power display
- [ ] Smart polling (idle vs charging intervals)
- [ ] All flow cards

### General
- [ ] App install from store
- [ ] App upgrade from v1.x
- [ ] Multiple devices (both drivers)
- [ ] Settings changes take effect

---

## Next Steps

### Immediate
1. ✅ Create feature branch (keep main clean)
2. Push branch to remote
3. Test on real Homey device
4. Fix any issues found during testing

### Before Publishing
1. Test with real Nissan vehicles (both generations)
2. Update app store screenshots
3. Write changelog for v2.0.0
4. Consider beta release first

### Future Enhancements
1. Add support for more Nissan EVs (Ariya?)
2. Implement energy tracking/statistics
3. Add scheduled charging control
4. Integration with Homey Energy

---

## Session Recovery Commands

To continue work in a new session:

```bash
cd C:\github\homey-nissan-leaf

# Check current state
git status
git log --oneline -5
git branch -a

# If on feature branch, continue development
# If on main, checkout feature branch:
git checkout feature/leaf-ze1-support

# Run the app for testing
homey app run

# Build to validate
homey app build
```

---

## Commit History

```
526a427 feat: Add support for 2019+ Nissan Leaf (ZE1) vehicles
f5b8c3e Bump version to v1.0.23
89b45df New leaf-connect version - API broke
```

---

## Contact & Resources

- **Original App**: https://github.com/RonnyWinkler/homey-nissan-leaf
- **Source App**: https://github.com/Moweezy/com.nissan.connect.new
- **Homey Dev Docs**: https://apps.developer.homey.app/
- **Kamereon API Docs**: (unofficial) https://github.com/mitchellrj/kamerern

---

*Last Updated: Session merge completion*
*Document Author: Claude (AI Assistant)*
