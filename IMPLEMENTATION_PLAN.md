# Implementation Plan: Merge Nissan Leaf Apps

## Overview

This document outlines the plan to merge the new `com.nissan.connect.new` app functionality into the existing `homey-nissan-leaf` repository while preserving backwards compatibility for existing users.

## Goals

1. Keep existing `com.nissan.leaf` app ID so users don't lose their devices/settings
2. Add support for 2019+ Nissan Leaf vehicles via new `leaf-ze1` driver
3. Upgrade existing `leaf` driver with new features (flow cards, location, etc.)
4. Migrate existing device capabilities to new naming scheme

## Drivers

| Driver ID | Target Vehicles | API |
|-----------|-----------------|-----|
| `leaf` | Pre-2019 (ZE0/AZE0) | Carwings via leaf-connect |
| `leaf-ze1` | 2019+ (ZE1) | Kamereon OAuth2 |

## Capability Migration (for existing v1.x devices)

| Old Capability | New Capability |
|----------------|----------------|
| `is_charging` | `charging_status` |
| `is_connected` | `connected_status` |
| `button_climate` | `onoff.climate` |
| `button_charging` | `button_start_charging` |
| `cruising_range_ac_off` | `measure_range` |
| `cruising_range_ac_on` | `measure_range_ac_on` |

## New Features

- 7 Flow trigger cards
- 4 Flow condition cards
- 8 Flow action cards
- GPS location tracking
- Refresh all data button
- Persistent climate mode (2019+ only)
- Smart polling intervals

## Phases

1. Add new dependencies & libraries
2. Update app metadata
3. Add new capabilities (keep old for migration)
4. Add flow cards
5. Update app.js with flow card registration
6. Update existing `leaf` driver with migration logic
7. Add new `leaf-ze1` driver
8. Merge locale files
9. Update assets
10. Build & test

## Version

- Current: 1.0.23
- Target: 2.0.0 (major version for breaking capability changes)
