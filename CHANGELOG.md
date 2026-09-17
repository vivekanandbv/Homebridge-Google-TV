# Changelog

All notable changes to this project will be documented in this file.

## [1.1.4-beta.4] - 2026-09-17

### Fixed
- **Cast Heartbeat & Keep-Alive**: Added active 15-second heartbeat PING intervals on `urn:x-cast:com.google.cast.tp.heartbeat` to prevent Chromecast from closing idle TLS sockets during standby.
- **Timeout & Reconnect Resilience**: Guarded Cast RPC calls (`getVolume`, `getStatus`) against socket timeout hangs during standby/semi-sleep state.
- **Network Standby Provisioning**: Configured TV Wi-Fi sleep policy and stay-on-plugged settings via ADB to maintain connection.

## [1.1.4-beta.3] - 2026-09-17

### Fixed
- **HomeKit Accessory Visibility**: Removed unintended auto-injection of `_bridge` (Child Bridge) on ADB pairing which moved the plugin into an un-paired bridge state.
- **Apple Home Setup Guidance**: Added explicit in-UI guidance explaining how to pair the Television External Accessory in the Apple Home app via **+** → **Add Accessory** → **More options...** with the Homebridge PIN.

## [1.1.4-beta.2] - 2026-09-17

### Fixed
- **Child Bridge Crash Guard**: Added global rejection and exception handlers to the child bridge process to prevent unhandled errors from terminating the process (`Child bridge ended (code 1, signal null)`).
- **Isolated ADB Media Polling**: Wrapped periodic ADB media polling in isolated exception handlers to eliminate unhandled promise rejections during background state refresh.
- **Container Package Provisioning**: Added non-root `sudo -n` fallback when installing `android-tools` via `apk` (Alpine Linux) and `apt-get` (Debian/Ubuntu) in containerized environments like Synology DSM Container Manager.
- **Safe Directory Operations**: Handled permissions errors (`EACCES`) gracefully during platform-tools directory initialization and stream file writing on restricted filesystems.
- **mDNS Socket Guard**: Added error handlers to `Bonjour` service and discovery browsers to prevent unhandled multicast UDP socket errors in Docker containers.
- **ADB Command Timeouts**: Added execution timeouts across all ADB discovery, connect, and media session commands to prevent daemon lockups from blocking the event loop.

## [1.1.4-beta.1] - 2026-09-16

### Fixed
- **Child Bridge Stability**: Added direct `castv2` and `protobufjs` dependency declarations to prevent module resolution failures in child bridge processes.
- **Safe Preloading**: Wrapped protobuf preloading in resilient exception handling so plugin startup never terminates prematurely.
- **Cast Protocol Stability**: Synchronously pre-load `cast_channel.proto` to eliminate the asynchronous `Error: extension not loaded yet` race condition during initial Cast client connection.
- **Multi-Architecture Support**: Gracefully handle Linux ARM/AArch64 architectures and prevent incompatible x86_64 binary extraction.

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
