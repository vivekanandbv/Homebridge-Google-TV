# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1-beta.12] - 2026-10-06

### Fixed
- **Settings UI Initialization**: Restored `showStep` and UI step navigation functions in `index.html` to fix modal launch and error handling.

### Added
- **Streamlined Single-PIN ADB Pairing**:
  - Implemented automatic background mDNS discovery of Wireless Debugging pairing & connect ports.
  - Simplified the Settings UI to a single 6-digit PIN input with auto-focus (tucking manual ports into an optional advanced dropdown).
  - Automated permanent port `5555` activation upon pairing so the TV stays connected across reboots without re-pairing.

## [1.2.1-beta.10] - 2026-10-06

### Fixed
- **Wireless Debugging Dual-Port Handshake & Automatic Port 5555 Activation**:
  - Updated the Settings UI pairing wizard to accept both the Main Connect Port (from the main Wireless Debugging screen) and the Pairing Port & PIN (from the pairing modal).
  - Implemented automatic `adb tcpip 5555` activation during pairing to unlock the standard permanent ADB port across reboots.
  - Enhanced `ADBClient` connection logic with smart fallback and active target resolution.

### Added
- **Interactive ADB Re-pairing**: Made the `✓ ADB Connected` badge in the Settings UI clickable with an explicit `(Re-pair)` button, allowing users to re-run the ADB pairing wizard whenever TV IP or Wireless Debugging ports reset.
- **Documentation**: Added comprehensive Developer Options and USB/Wireless Debugging setup instructions to `README.md`.

## [1.2.1-beta.8] - 2026-10-06

### Fixed
- **Media Playback State & Volume Bulb Sync**:
  - Rewrote ADB `dumpsys media_session` parser to be indentation-agnostic across Android 10/11/12/13/14 session stack formats.
  - Implemented priority scanning across all media sessions to ensure active `PLAYING` (state 3) sessions are detected even when background assistant or system sessions are present.
  - Fixed media polling lifecycle in `MediaStateManager` to start immediately upon connection and reliably synchronize playback state with the Volume Bulb accessory in Apple Home.

### Fixed
- **InputSource Identifier Closure Bug**: Fixed a closure variable capture issue in `setupInputSources` where all inputs returned the final loop ID (causing Apple Home to collapse all configured inputs into the last input e.g. HDMI 4). Each input source now permanently retains its unique identifier, configured name, and visibility states.

### Fixed
- **App Switching over Android TV Remote Protocol**: Added native `sendAppLink` support to launch streaming apps (YouTube, Netflix, Prime Video, Disney+, etc.) directly over the encrypted Remote Protocol v2 TLS connection without requiring ADB.
- **Universal Input Target Resolution**: Added case-insensitive and whitespace-tolerant resolution for all HDMI and hardware inputs (`HDMI 1`, `HDMI1`, `HDMI-1`, `Composite`, `Component`, etc.) to prevent skipped input services.
- **InputSource Characteristic Getters & Linking**: Bound explicit HAP getters (`ConfiguredName`, `Name`, `Identifier`, `IsConfigured`, `CurrentVisibilityState`, `TargetVisibilityState`) and dynamic identifier mapping for all configured inputs to ensure full Apple HomeKit compliance.

## [1.2.1-beta.3] - 2026-10-01

### Added
- **Apple Home Icon / Category Selection**: Added configuration option allowing users to choose how the accessory is categorized and displayed in the Apple Home app:
  - **Television** (`TELEVISION`) — Default
  - **Streaming Stick** (`TV_STREAMING_STICK`)
  - **Set-Top Box** (`TV_SET_TOP_BOX`)
  - **Apple TV** (`APPLE_TV`)
- **Settings UI & Schema Integration**: Added an "Apple Home Icon" selector dropdown directly inside each TV card in the Homebridge Settings dashboard and configuration schema.
- **Credits & Attribution**: Credit and thanks to **rubenRP** ([homebridge-chromecast-google-tv](https://github.com/rubenRP/homebridge-chromecast-google-tv)) for the HomeKit accessory category selection architecture.

## [1.2.1-beta.2] - 2026-09-24

### Added
- **HDMI & Hardware Source Switching**: Added native Apple Home input switching support for HDMI 1, HDMI 2, HDMI 3, HDMI 4, Composite 1/2, Component 1/2, Live TV, and TV Input Selector.
- **Direct Remote & ADB Keycode Dispatch**: Dispatches standard Android hardware keycodes (`KEYCODE_TV_INPUT_HDMI_1..4`, `KEYCODE_TV`, `KEYCODE_TV_INPUT`) seamlessly via Android TV Remote Protocol v2 or ADB keyevent fallback.
- **Custom Settings UI Input Selector**: Extended the visual TV configuration dashboard to include all HDMI and hardware inputs in the standard input selector dropdown for easy 1-click addition/removal.
- **Credits & Attribution**: Due credit and thanks to **Tharun P Karun** ([homebridge-androidtv-ultimate](https://github.com/tharunpkarun/homebridge-androidtv-ultimate)) for the Android TV hardware input keycode mapping architecture.

## [1.1.4] - 2026-09-22

### Added
- **Option to Disable Volume Dimmer Lightbulb (#2)**: Added per-TV configuration toggle (`disableVolumeBulb`) and settings UI checkbox to prevent the separate volume/playback lightbulb accessory from appearing in HomeKit.
- **Dedicated Re-pair Remote Action**: Added a 1-click **"(Re-pair)"** action directly on TV cards in the Homebridge settings UI with socket teardown isolation.

### Fixed
- **Verified Power State & Reversion Guard (#4)**: Removed synthetic/optimistic power state mutations. If the TV is in deep sleep or unreachable (`EHOSTUNREACH`), the HomeKit switch automatically snaps back to **OFF** instead of falsely showing ON.
- **Volume Lightbulb ADB Requirement (#3)**: Restricted the Volume/Playback Dimmer Lightbulb to only appear when ADB is explicitly configured (`adbIpPort`), automatically purging orphan lightbulbs for Cast-only setups.
- **Prevent Phantom Device Discovery (#3)**: Restricted mDNS discovery and accessory publishing strictly to configured TVs in settings, ignoring unconfigured LAN Cast devices (e.g. AV receivers, Nest speakers).
- **ADB Fallback for Remote Keys & Power**: Added automatic ADB fallback (`adb shell input keyevent`) for all HomeKit remote buttons (D-pad arrows, Select, Back, Play/Pause, Volume) and Power (`224` wakeup / `223` sleep) whenever the Android TV Remote SSL connection is disconnected or un-paired.
- **Cast Protocol Heartbeat & Keep-Alive**: Added active 15-second heartbeat PING intervals to prevent Chromecast devices from dropping idle TLS sockets during standby.
- **RemoteManager Uncaught Exception Guard**: Patched internal `RemoteManager` EventEmitter error handling to eliminate `ERR_UNHANDLED_ERROR` uncaught exceptions when Google TV rejects a certificate handshake (`code1: 622`).
- **Synology DSM & Container Compatibility**: Added non-root `sudo -n` fallback when provisioning `android-tools` via `apk` (Alpine Linux) and `apt-get` (Debian/Ubuntu), wrapped mDNS UDP sockets, and handled restricted filesystem permissions (`EACCES`).
- **Child Bridge Stability**: Added global rejection and exception handlers, direct dependency declarations (`castv2`, `protobufjs`), and synchronous protobuf preloading to prevent child bridge process termination.
- **Remote Pairing Timeout Guard**: Added strict 10s socket timeouts on port 6467 and client-side race guards in the plugin UI to eliminate endless loading loops during remote pairing.

### Changed
- **Optimized Console Logging**: Silenced routine 3-second background ADB media polling logs and rate-limited steady-state playback resolution logs to once every 2 minutes (or immediately on state change).

### Documentation
- **IP Stability & MAC Randomization Guide**: Added setup documentation on disabling Android TV MAC address randomization ("Use device MAC") and configuring direct Static IPs to prevent broken DHCP reservations.

## [1.1.3] - 2026-09-15

### Fixed
- **HomeKit UI Sync**: Fixed an issue where the TV power switch would bounce back to "On" in the Apple Home app immediately after being switched off due to asynchronous state propagation. Applied optimistic state updates for instantaneous UI feedback.

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
