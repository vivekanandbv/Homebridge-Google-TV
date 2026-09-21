# Homebridge Google TV

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
* **Input Switching**: Preloaded with *Home*, *YouTube*, *Netflix*, and *Prime Video*. Selecting an app switches the TV input and opens it instantly.

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

### Optional ADB pairing (to expose volume/playback status as a dimmer bulb in home app) ###

6. Click **Enhance with ADB** and follow the onscreen instructions.
7. Manually restart homebridge.
8. Open your iOS **Home App** → **Add Accessory** → **More  options...**, select your dimmer bulb exposed as a bridge and enter the Homebridge Setup PIN configured on your Homebridge instance. 
* The dimmer will reflect the playback status and the volume level of your TV, which you can use for automations, like turning the lights on/off or opening/closing the blinds based on whether the TV is playing or paused. You should also be able to use input sources from the TV accessory to switch between apps now.
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
