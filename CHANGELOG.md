# Changelog

All notable changes to this project will be documented in this file.

## [1.1.2] - 2026-09-14

### Added
- **Funding Options**: Added GitHub Sponsors support for the project.

### Fixed
- **Documentation**: Clarified instructions in the README regarding TV control behaviors.

## [1.1.1] - 2026-09-12

### Fixed
- **Orphaned Lightbulbs on Upgrade**: Fixed an issue where upgrading from 1.0.x to 1.1.x would leave behind an orphaned "Ghost" volume lightbulb accessory in Homebridge due to the new Dynamic UUID engine. The plugin now automatically unregisters the old cache.

## [1.1.0] - 2026-09-12

### Added
- **Auto-Healing Connections (Dynamic IP Tracking)**: The plugin now intelligently tracks the TV's permanent hardware ID. If the TV's IP address changes, the plugin instantly detects it, silently updates its own configuration in the background, and reconnects automatically. You never have to touch the Homebridge UI!
- **Automatic ADB Port Discovery**: The plugin's network scanner instantly detects newly randomized ADB ports over the air and seamlessly connects to it. (Note: Users still need to use their physical remote to toggle Wireless Debugging back ON if their router changes their IP, but once they do, the plugin handles the rest automatically!)

### Fixed
- **No More UI Freezes ("Scanning for TVs" Bug Fixed)**: Applied strict timeouts. The UI will now load instantly and never freeze, regardless of whether your TVs are online or completely dead.
- **No More Duplicate "Ghost" TVs**: The network scanner is now much smarter and strictly prioritizes the primary IPv4 connection, completely eliminating duplicate TV discoveries on modern dual-stack routers.
- **Massively Improved Homebridge Stability**: The plugin now features a polite 30-second cooldown. If a TV drops offline, it patiently waits before trying again, preventing lockups and ensuring Homebridge runs flawlessly for months without crashing.

## [1.0.4] - 2026-09-12
### Added
- Added automatic TV background configuration to persist Wi-Fi connection during deep sleep.

## [1.0.3] - 2026-09-12

### Fixed
- Fixed an issue where the TV accessory would become "Not Responding" due to the child bridge crashing when the TV goes into deep sleep or briefly drops off the network.

## [1.0.2]
### Fixed
- Fixed ADB installer error handling.
- Added automatic ADB installation fallback.

## [1.0.0]
- Initial Release
