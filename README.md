# Homebridge Google TV

[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=flat&logo=github)](https://github.com/sponsors/vivekanandbv)
[![npm version](https://img.shields.io/npm/v/homebridge-google-tv.svg)](https://www.npmjs.com/package/homebridge-google-tv)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-google-tv.svg)](https://www.npmjs.com/package/homebridge-google-tv)

An integrated Homebridge plugin that integrates Google Chromecast and Android TV devices into Apple HomeKit with support for remote control widgets, dynamic volume dimmers, input switching, and real-time playback synchronization.

——

## Installation

Install the plugin from npm:

npm install -g homebridge-google-tv

---

## Architecture: Tri-Backend System

To provide absolute reliability, this plugin orchestrates three independent connection layers for each device:

1. **Google Cast Protocol**: Handles multicast discovery and retrieves Cast playback status and volume levels.
2. **Android TV Remote Protocol**: Simulates physical keys (directional arrows, select, back, home) and handles TV power sleep/wakeup.
3. **ADB MediaSession**: Polls the Android media subsystem to track playback states inside native apps (such as Netflix, Prime Video, or YouTube) that don't advertise over standard Cast.

---

## Dual Accessory Design

Each configured TV exposes **two distinct tiles** in your Apple Home App:

### 1. The TV Tile (Unbridged External Accessory)

* **Native TV UI**: Renders as a native Apple compatible TV accessory. Tapping it opens the power toggle and opening it navigates into the input selector.
* **Apple TV Remote Widget**: Integrates with the iOS Control Center Remote Widget. You can navigate the screen using directional arrows, select, back, home, and **adjust the TV volume using your iPhone's physical volume buttons**.
* **Input & HDMI Source Switching**: Switch between installed streaming apps (*YouTube*, *Netflix*, *Prime Video*, *Disney+*, *Apple TV*, etc.) as well as physical hardware ports (**HDMI 1**, **HDMI 2**, **HDMI 3**, **HDMI 4**, **Live TV**, **Component**, **Composite**) directly from the Apple Home input selector wheel.

### 2. The Volume Dimmer Lightbulb (Bridged Accessory)

* **Play/Pause Sync**: Turning the bulb ON/OFF sends play/pause commands to the TV.
* **Volume Dimmer**: Adjusting the brightness slider (0% to 100%) controls the Chromecast cast volume level.
* **Bi-directional Sync**: If you play or pause the TV using a physical remote, the lightbulb automatically turns ON or OFF in your Home app in real-time.

---

## Key Features

* **Zero-Dependency ADB Auto-Installer**: During installation, the plugin automatically detects your host OS (macOS, Linux, or Windows) and downloads the official Google Android Platform Tools. You do **not** need to install Homebrew, Python, or ADB manually.
* **Two-Phase Remote Pairing**: Provides a smooth pairing screen in the Homebridge UI that avoids the TV spawning endless spontaneous PIN codes.
* **Sandboxed UI**: A fully responsive settings page designed to work inside sandboxed iframes.
* **Manual Port Fallback**: An input field to manually enter dynamic ADB ports if your local router blocks mDNS discovery packets.

---

## Setup & Pairing

> **Note on Network Changes & IP Stability**: This plugin features **Dynamic IP Tracking**. If your router changes your TV's IP address, the plugin will auto-detect the new IP using its permanent Cast ID and reconnect. However, **Android disables Wireless Debugging whenever your IP changes**. For the absolute best stability, keep your TV's IP address permanent using one of the two methods below:
>
> 1. **Option A: Router DHCP Reservation (Disable MAC Randomization)**:
>    * Android 12+ / Google TV enables *"Randomized MAC"* by default, which can cause router DHCP reservations to fail or reset across network changes.
>    * On your TV, go to: **Settings** → **Network & Internet** → select your **Wi-Fi Network** → **Privacy** (or Advanced) → switch from *"Use randomized MAC"* to **"Use device MAC"**.
>    * Note the hardware MAC address shown and bind your chosen IP (e.g. `192.168.1.59`) to that MAC address in your router.
>
> 2. **Option B: Set Static IP Directly on the TV**:
>    * On your TV, go to: **Settings** → **Network & Internet** → select your **Wi-Fi Network** → scroll to **IP Settings** → change from **DHCP** to **Static**.
>    * Enter your IP address (e.g. `192.168.1.59`), Gateway (e.g. `192.168.1.1`), Network prefix length (`24`), and DNS (`192.168.1.1` or `8.8.8.8`). This permanently locks the IP on the TV itself.

### Remote and TV pairing ###

1. Go to the **Plugins** tab in Homebridge, find **Homebridge Google TV**, and click **Settings**.
2. Wait for it to discover your TV or add it manually using its IP.
3. Click **Pair Remote** and enter the 4-digit PIN displayed on your TV.
4. Click **save and restart** option and then manually restart homebridge
5. Since the TV accessory is an unbridged external accessory, add the TV manually into home app:  
      Open your iOS **Home App** → **Add Accessory** → **More  options...**, select your TV, and enter the Homebridge Setup PIN configured on your Homebridge instance. (You will be able to use the control centre remote now.)

### Optional ADB Pairing (Enabling Volume / Playback Dimmer Bulb)

To track real-time playback state inside streaming apps (*Netflix*, *Prime Video*, *YouTube*, etc.) and expose the Volume/Playback Dimmer Bulb in Apple Home, enable Developer Options and USB Debugging on your TV:

1. **Enable Developer Options on TV**:
   * On your TV, navigate to **Settings** → **System** → **About**.
   * Scroll down to **Android TV OS build** (or **Build**) and press the **Select** button **7 times** until you see the prompt *"You are now a developer!"*.
2. **Enable USB Debugging (Network ADB)**:
   * Go back to **Settings** → **System** → **Developer Options**.
   * Toggle **ON** **USB Debugging** (and **Wireless Debugging** if available on Android 11+).
3. **Pair with ADB in Homebridge**:
   * In Homebridge UI → **Homebridge Google TV** Settings, click **Enhance with ADB** and follow the on-screen instructions (or enter your TV's IP and ADB port, default `5555`).
   * When the *"Allow USB debugging?"* prompt appears on your TV screen, check **"Always allow from this computer"** and select **OK / Allow**.
4. **Restart Homebridge**:
   * Save settings and restart Homebridge.
5. **Add Dimmer Bulb in Apple Home**:
   * Open your iOS **Home App** → **Add Accessory** → **More options...**, select your **Volume / Playback Dimmer Bulb**, and enter your Homebridge setup PIN.
   * *The dimmer reflects playback status (On = Playing, Off = Paused) and volume level (0–100%), allowing automations like dimming lights when playback begins.*
---

## Managing TV Input Sources (UI Guide)

You can easily add, remove, and configure custom input sources directly from the visual Settings UI dashboard:

### 1. Removing a Source

* Look at your configured TV card in the Settings UI. It displays checkboxes of all **currently enabled** inputs.
* To remove any input source, simply **uncheck** its box. It will instantly be deleted from the active list.

### 2. Adding a Predefined Source

* Click the **`+ Add App/Source...`** dropdown selector under the checklist.
* Choose any standard streaming service (such as *Disney+*, *Apple TV*, *Hulu*, etc.) to add it to your checked inputs checklist.

### 3. Adding a Custom Source/App

* If you want to add an app that is not in the standard list (such as *Kodi* or *VLC*):
  1. Click the **`+ Add App/Source...`** dropdown and select **`-- Custom App --`**.
  2. An inline form will open. Enter:
     * **App Name**: The display name you want to see in the Home app (e.g., `Kodi`).
     * **Package Name**: The Android package identifier for the app (e.g., `org.xbmc.kodi`).
  3. Click **Add**. The custom app will be registered, enabled, and saved.
* **Saving changes**: Click **Save** in the settings modal and **Restart Homebridge** to apply the updated input sources wheel in Apple Home!

---

## Apple Home Icon (Device Category)

You can customize the accessory icon displayed in Apple Home without changing any device functionality.

In the **Settings UI**, select your preferred **Apple Home Icon**:
* **Television** (`TELEVISION`) — Standard TV icon (Default)
* **Streaming Stick** (`TV_STREAMING_STICK`) — Streaming stick icon (e.g. Chromecast / FireStick)
* **Set-Top Box** (`TV_SET_TOP_BOX`) — Set-top box / receiver icon
* **Apple TV** (`APPLE_TV`) — Apple TV icon

> [!NOTE]
> **Apple Home Icon Caching Caveat**: Because TV accessories in HomeKit are unbridged external accessories, Apple Home caches the accessory category icon when the accessory is first paired. If you change the category on an already-paired TV in HomeKit, you may need to remove the TV from Apple Home and re-pair it to see the updated icon.

---

## Credits & Acknowledgements

* **rubenRP** ([homebridge-chromecast-google-tv](https://github.com/rubenRP/homebridge-chromecast-google-tv)) — for the HomeKit accessory category / icon selection architecture.
* **Tharun P Karun** ([homebridge-androidtv-ultimate](https://github.com/tharunpkarun/homebridge-androidtv-ultimate)) — for the Android TV hardware input and HDMI keycode mapping architecture.
* **FoxxMD** ([chromecast-client](https://github.com/FoxxMD/chromecast-client)) — for Google Cast protocol client support.

---

## Support & Sponsorship ❤️

If you enjoy using **Homebridge Google TV** and would like to support continuous development and maintenance, consider [becoming a sponsor on GitHub](https://github.com/sponsors/vivekanandbv)!
