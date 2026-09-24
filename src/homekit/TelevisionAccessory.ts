/* eslint-disable @typescript-eslint/no-explicit-any */
import { Service, PlatformAccessory } from 'homebridge';
import { ADBCastPlatform } from '../platform.js';
import { CastClient } from '../cast/CastClient.js';
import { AndroidTVClient } from '../cast/AndroidTVClient.js';
import { ADBClient, adbPath } from '../cast/ADBClient.js';
import { MediaStateManager } from '../cast/MediaStateManager.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface InputDefinition {
  package?: string;
  type: number;
  key?: number;
}

// Input and App catalog.
// Hardware and HDMI input keycode mappings inspired by Tharun P Karun (homebridge-androidtv-ultimate).
const appPackageMap: { [key: string]: InputDefinition } = {
  'Home': { package: 'com.google.android.apps.tv.referencelauncher', type: 1, key: 3 },
  'HDMI 1': { type: 3, key: 243 }, // KEYCODE_TV_INPUT_HDMI_1
  'HDMI 2': { type: 3, key: 244 }, // KEYCODE_TV_INPUT_HDMI_2
  'HDMI 3': { type: 3, key: 245 }, // KEYCODE_TV_INPUT_HDMI_3
  'HDMI 4': { type: 3, key: 246 }, // KEYCODE_TV_INPUT_HDMI_4
  'Composite 1': { type: 4, key: 247 }, // KEYCODE_TV_INPUT_COMPOSITE_1
  'Composite 2': { type: 4, key: 248 }, // KEYCODE_TV_INPUT_COMPOSITE_2
  'Component 1': { type: 6, key: 249 }, // KEYCODE_TV_INPUT_COMPONENT_1
  'Component 2': { type: 6, key: 250 }, // KEYCODE_TV_INPUT_COMPONENT_2
  'Live TV': { type: 2, key: 170 }, // KEYCODE_TV
  'TV Input': { type: 0, key: 178 }, // KEYCODE_TV_INPUT
  'YouTube': { package: 'com.google.android.youtube.tv', type: 10 },
  'Netflix': { package: 'com.netflix.ninja', type: 10 },
  'Prime Video': { package: 'com.amazon.amazonvideo.livingroom', type: 10 },
  'Disney+': { package: 'com.disney.disneyplus', type: 10 },
  'Apple TV': { package: 'com.apple.atve.android.appletv', type: 10 },
  'Hulu': { package: 'com.hulu.livingroomplus', type: 10 },
  'HBO Max': { package: 'com.hbo.hbonow', type: 10 },
  'Spotify': { package: 'com.spotify.tv.android', type: 10 },
  'Plex': { package: 'com.plexapp.android', type: 10 },
};

export class TelevisionAccessory {
  private tvService: Service;
  private speakerService: Service;
  private bulbService?: Service;
  private castClient: CastClient;
  private androidTVClient: AndroidTVClient;
  private adbClient?: ADBClient;
  private mediaStateManager: MediaStateManager;
  private isPowerOn = false;
  private currentInputId = 1;
  private lastLoggedPlaybackState = '';
  private lastPlaybackLogTime = 0;
  private inputServices: Service[] = [];

  constructor(
    private readonly platform: ADBCastPlatform,
    private readonly tvAccessory: PlatformAccessory,
    private readonly bulbAccessory: PlatformAccessory | undefined,
    ip: string,
  ) {
    const devices = this.platform.config.devices || [];
    const deviceConfig = devices.find((d: any) => d.ip === ip) || {};
    
    const cert = deviceConfig.cert || this.platform.config.cert;
    const adbIpPort = deviceConfig.adbIpPort || this.platform.config.adbIpPort;

    this.castClient = new CastClient(ip);
    this.androidTVClient = new AndroidTVClient(ip, this.platform.config.pairingCode, cert);
    
    if (adbIpPort) {
      const port = parseInt(adbIpPort.split(':')[1]) || 5555;
      this.platform.log.info(`[TelevisionAccessory] Initializing ADB Client for ${ip}:${port}`);
      this.adbClient = new ADBClient(ip, port, (msg, isError) => {
        if (isError) {
          this.platform.log.error(`[ADBClient] ${msg}`);
        } else {
          this.platform.log.debug(`[ADBClient] ${msg}`);
        }
      });
    }
    
    this.mediaStateManager = new MediaStateManager(this.castClient, this.androidTVClient, this.adbClient);

    this.androidTVClient.on('error', (err) => {
      this.platform.log.debug(`[AndroidTVClient] Background connection error: ${err?.message || err}`);
    });

    this.androidTVClient.on('unpaired', () => {
      this.platform.log.warn(`[AndroidTVClient] Remote certificate rejected on ${ip}. Falling back to ADB for button & power controls.`);
    });

    this.castClient.on('error', (err) => {
      this.platform.log.debug(`[CastClient] Background connection error: ${err?.message || err}`);
    });

    this.androidTVClient.on('ready', () => {
      this.platform.log.info(`[AndroidTV] Successfully paired and connected to ${ip}`);
    });

    this.androidTVClient.on('powered', (powered: boolean) => {
      if (this.isPowerOn !== powered) {
        this.platform.log.info(`[AndroidTV] Live power state changed: ${powered ? 'ON' : 'OFF'}`);
      }
      this.isPowerOn = powered;
      this.tvService.updateCharacteristic(this.platform.Characteristic.Active, powered ? 1 : 0);
    });

    const tvId = tvAccessory.context.device?.id || `ADBCast-${ip}`;
    const tvName = tvAccessory.context.device?.name || 'Google TV';

    this.tvAccessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Google')
      .setCharacteristic(this.platform.Characteristic.Model, 'Chromecast HD TV')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, tvId);

    if (this.bulbAccessory) {
      const bulbId = this.bulbAccessory.context.device?.id || `ADBCast-Vol-${ip}`;
      this.bulbAccessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Google')
        .setCharacteristic(this.platform.Characteristic.Model, 'Volume Dimmer Lightbulb')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, bulbId);
    }

    // 1. Setup primary Television Service on the TV Accessory
    this.tvService = this.tvAccessory.getService(this.platform.Service.Television)
      || this.tvAccessory.addService(this.platform.Service.Television, tvName);

    this.tvService.setPrimaryService(true);
    this.tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, tvName);
    this.tvService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );
    this.tvService.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, 1);

    this.tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(async (value) => {
        this.platform.log.info(`[TV Power] Set Active -> ${value === 1 ? 'ON' : 'OFF'}`);
        const turnOn = value === 1;
        let commandSent = false;

        if (this.androidTVClient.isRemoteConnected) {
          try {
            if (turnOn) {
              commandSent = await this.androidTVClient.powerOn();
            } else {
              commandSent = await this.androidTVClient.powerOff();
            }
          } catch (e: any) {
            this.platform.log.debug(`[TV Power] androidTVClient power failed: ${e?.message || e}`);
          }
        }

        if (!commandSent && this.adbClient) {
          this.platform.log.info(`[TV Power] Remote unavailable. Using ADB fallback to power ${turnOn ? 'ON' : 'OFF'}`);
          if (turnOn) {
            commandSent = await this.adbClient.powerOn();
          } else {
            commandSent = await this.adbClient.powerOff();
          }
        }

        if (!commandSent) {
          this.platform.log.warn('[TV Power] TV is unreachable (neither Remote nor ADB responded). Reverting power switch in HomeKit.');
          this.isPowerOn = false;
          setTimeout(() => {
            this.tvService.updateCharacteristic(this.platform.Characteristic.Active, 0);
          }, 500);
          return;
        }

        this.isPowerOn = turnOn;
      })
      .onGet(async () => {
        if (this.androidTVClient.isRemoteConnected) {
          return this.androidTVClient.isPowerOn ? 1 : 0;
        }
        if (this.adbClient && this.adbClient.isConnected) {
          const adbPower = await this.adbClient.getPowerState();
          if (adbPower !== null) {
            this.isPowerOn = adbPower;
            return adbPower ? 1 : 0;
          }
        }
        return this.isPowerOn ? 1 : 0;
      });

    this.tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(async (value) => {
        const id = value as number;
        this.platform.log.info(`[TV Input] Select Input ID -> ${id}`);
        this.currentInputId = id;
        await this.launchInputApp(id);
        this.tvService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, id);
      })
      .onGet(async () => {
        return this.currentInputId;
      });

    this.tvService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet(async (value) => {
        const key = value as number;
        this.platform.log.info(`[TV RemoteKey] Key Pressed -> ${key}`);
        await this.handleRemoteKey(key);
      });

    // 2. Setup Television Speaker Service (Volume UP/DOWN) on the TV Accessory
    this.speakerService = this.tvAccessory.getService(this.platform.Service.TelevisionSpeaker)
      || this.tvAccessory.addService(this.platform.Service.TelevisionSpeaker, `${tvName} Speaker`);

    this.speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.RELATIVE);

    this.speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        const selector = value as number;
        if (selector === this.platform.Characteristic.VolumeSelector.INCREMENT) {
          this.platform.log.info('[TV Speaker] Volume Up');
          await this.sendKey(24);
        } else {
          this.platform.log.info('[TV Speaker] Volume Down');
          await this.sendKey(25);
        }
      });

    this.speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onSet(async (value) => {
        this.platform.log.info(`[TV Speaker] Set Mute -> ${value}`);
        let muteSuccess = false;
        if (this.androidTVClient.isRemoteConnected) {
          try {
            muteSuccess = await this.androidTVClient.setMuted(value as boolean);
          } catch { /* ignore */ }
        }
        if (!muteSuccess && this.adbClient) {
          await this.adbClient.sendKey(164); // KEYCODE_VOLUME_MUTE
        }
      });

    // Link Speaker Service to the Primary Television Service
    this.tvService.addLinkedService(this.speakerService);

    this.setupInputSources();

    // 3. Setup the volume/playback Lightbulb service on the Bulb Accessory (if enabled)
    if (this.bulbAccessory) {
      const bulbName = this.bulbAccessory.context.device?.name || `${tvName} Volume`;
      this.bulbService = this.bulbAccessory.getService(this.platform.Service.Lightbulb)
        || this.bulbAccessory.addService(this.platform.Service.Lightbulb, bulbName);

      this.bulbService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value) => {
          this.platform.log.info(`[Volume Bulb] Set Play/Pause -> ${value ? 'PLAY' : 'PAUSE'}`);
          await this.mediaStateManager.setPlayPause(value as boolean);
        })
        .onGet(async () => {
          const state = this.mediaStateManager.getResolvedPlaybackState();
          return state.state === 'PLAYING';
        });

      this.bulbService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(async (value) => {
          this.platform.log.info(`[Volume Bulb] Set Volume -> ${value}%`);
          await this.castClient.setVolume((value as number) / 100);
        })
        .onGet(async () => {
          try {
            const vol = await this.castClient.getVolume();
            if (vol && typeof vol.level === 'number') {
              return Math.round(vol.level * 100);
            }
          } catch { /* ignore */ }
          return 0;
        });

      // 4. Sync media state updates to the Bulb accessory
      this.mediaStateManager.on('state_changed', () => {
        try {
          if (this.bulbService) {
            const mediaState = this.mediaStateManager.getResolvedPlaybackState();
            const now = Date.now();
            const stateKey = `${mediaState.state}-${mediaState.source}`;
            if (stateKey !== this.lastLoggedPlaybackState || now - this.lastPlaybackLogTime >= 120000) {
              this.platform.log.info(`[PlaybackState] Resolved: ${mediaState.state} (Source: ${mediaState.source})`);
              this.lastLoggedPlaybackState = stateKey;
              this.lastPlaybackLogTime = now;
            } else {
              this.platform.log.debug(`[PlaybackState] Resolved: ${mediaState.state} (Source: ${mediaState.source})`);
            }
            this.bulbService.updateCharacteristic(this.platform.Characteristic.On, mediaState.state === 'PLAYING');
          }
        } catch { /* ignore */ }
      });
    }

    this.connect().catch((err) => {
      this.platform.log.debug(`[TelevisionAccessory] Initial connect error: ${err?.message || err}`);
    });
    setInterval(() => {
      this.updateState().catch((err) => {
        this.platform.log.debug(`[TelevisionAccessory] updateState error: ${err?.message || err}`);
      });
    }, 10000);
  }

  private setupInputSources() {
    const devices = this.platform.config.devices || [];
    const deviceConfig = devices.find((d: any) => d.ip === this.tvAccessory.context.device.ip) || {};
    const enabledInputs = deviceConfig.inputs || ['Home', 'YouTube', 'Netflix', 'Prime Video'];
    const customApps = deviceConfig.customApps || [];

    const existingInputs = this.tvAccessory.services.filter(s => s.UUID === this.platform.Service.InputSource.UUID);
    for (const s of existingInputs) {
      this.tvAccessory.removeService(s);
    }

    this.inputServices = [];

    // Merge standard appPackageMap with configured customApps
    const localAppMap: { [key: string]: InputDefinition } = { ...appPackageMap };
    for (const app of customApps) {
      localAppMap[app.name] = { package: app.package, type: 10 }; // APPLICATION = 10
    }

    let id = 1;
    for (const inputName of enabledInputs) {
      const target = localAppMap[inputName];
      if (!target) {
        continue;
      }

      const inputService = this.tvAccessory.addService(this.platform.Service.InputSource, inputName.toLowerCase(), inputName);
      
      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, id)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, inputName)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, target.type)
        .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, this.platform.Characteristic.CurrentVisibilityState.SHOWN)
        .setCharacteristic(this.platform.Characteristic.TargetVisibilityState, this.platform.Characteristic.TargetVisibilityState.SHOWN);

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
      id++;
    }
  }

  private async launchInputApp(id: number) {
    const devices = this.platform.config.devices || [];
    const deviceConfig = devices.find((d: any) => d.ip === this.tvAccessory.context.device.ip) || {};
    const enabledInputs = deviceConfig.inputs || ['Home', 'YouTube', 'Netflix', 'Prime Video'];
    const customApps = deviceConfig.customApps || [];
    
    const inputName = enabledInputs[id - 1];
    if (!inputName) {
      return;
    }

    // Merge standard appPackageMap with configured customApps
    const localAppMap = { ...appPackageMap };
    for (const app of customApps) {
      localAppMap[app.name] = { package: app.package, type: 10 };
    }

    const target = localAppMap[inputName];
    if (!target) {
      return;
    }

    try {
      if (target.key !== undefined) {
        this.platform.log.info(`[TV Input] Switching input to ${inputName} (Keycode: ${target.key})`);
        await this.sendKey(target.key);
        return;
      }
      
      if (target.package) {
        if (this.adbClient && this.adbClient.isConnected && this.adbClient.targetIdentifier) {
          this.platform.log.info(`[TV Input] Launching app ${inputName} (${target.package}) over ADB`);
          const monkeyCmd = `"${adbPath}" -s ${this.adbClient.targetIdentifier} ` +
            `shell monkey -p ${target.package} -c android.intent.category.LEANBACK_LAUNCHER 1`;
          await execAsync(monkeyCmd, { timeout: 5000 });
        } else {
          this.platform.log.warn(`[TV Input] ADB not connected, cannot launch ${inputName}`);
        }
      }
    } catch (e: any) {
      this.platform.log.error(`[TV Input] Failed to launch ${inputName}: ${e.message}`);
    }
  }

  private async sendKey(keyCode: number): Promise<boolean> {
    let success = false;
    if (this.androidTVClient.isRemoteConnected) {
      try {
        success = await this.androidTVClient.sendKey(keyCode);
      } catch (e: any) {
        this.platform.log.debug(`[TelevisionAccessory] androidTVClient.sendKey failed: ${e?.message || e}`);
      }
    }

    if (!success && this.adbClient) {
      this.platform.log.info(`[TelevisionAccessory] Remote unavailable. Using ADB fallback for keyevent ${keyCode}`);
      success = await this.adbClient.sendKey(keyCode);
    }

    if (!success) {
      this.platform.log.warn(`[TelevisionAccessory] Failed to send key ${keyCode}: Neither Remote nor ADB is connected.`);
    }

    return success;
  }

  private async handleRemoteKey(key: number) {
    const Char = this.platform.Characteristic;
    switch (key) {
    case Char.RemoteKey.REWIND:
      await this.sendKey(89);
      break;
    case Char.RemoteKey.FAST_FORWARD:
      await this.sendKey(90);
      break;
    case Char.RemoteKey.NEXT_TRACK:
      await this.sendKey(87);
      break;
    case Char.RemoteKey.PREVIOUS_TRACK:
      await this.sendKey(88);
      break;
    case Char.RemoteKey.ARROW_UP:
      await this.sendKey(19);
      break;
    case Char.RemoteKey.ARROW_DOWN:
      await this.sendKey(20);
      break;
    case Char.RemoteKey.ARROW_LEFT:
      await this.sendKey(21);
      break;
    case Char.RemoteKey.ARROW_RIGHT:
      await this.sendKey(22);
      break;
    case Char.RemoteKey.SELECT:
      await this.sendKey(66);
      break;
    case Char.RemoteKey.BACK:
      await this.sendKey(4);
      break;
    case Char.RemoteKey.EXIT:
      await this.sendKey(4);
      break;
    case Char.RemoteKey.PLAY_PAUSE:
      await this.sendKey(85);
      break;
    case Char.RemoteKey.INFORMATION:
      await this.sendKey(82);
      break;
    }
  }

  async connect() {
    this.platform.log.info(`Connecting to Cast Device: ${this.tvAccessory.context.device.name}`);
    
    let anyConnected = false;

    try {
      await this.castClient.connect();
      anyConnected = true;
    } catch (e) {
      this.platform.log.error('CastClient connect failed:', e);
    }
    
    const devices = this.platform.config.devices || [];
    const deviceConfig = devices.find((d: any) => d.ip === this.tvAccessory.context.device.ip) || {};
    const cert = deviceConfig.cert || this.platform.config.cert;

    if (cert) {
      try {
        await this.androidTVClient.connect();
        anyConnected = true;
      } catch (e) {
        this.platform.log.error('AndroidTVClient connect failed:', e);
      }
    } else {
      this.platform.log.info('[TelevisionAccessory] Skipping remote connection: No paired cert saved yet.');
    }

    if (this.adbClient) {
      try {
        const adbConnected = await this.adbClient.connect();
        if (adbConnected) {
          anyConnected = true;
        }
      } catch (e) {
        this.platform.log.error('ADBClient connect failed:', e);
      }
    }

    if (anyConnected) {
      this.isPowerOn = true;
      this.updateState();
    } else {
      this.platform.log.error('CastClient, AndroidTVClient, and ADBClient failed to connect.');
      this.isPowerOn = false;
    }
  }

  async updateState() {
    // Verify true power status if remote is not directly pushing events
    if (this.adbClient && this.adbClient.isConnected && !this.androidTVClient.isRemoteConnected) {
      const adbPower = await this.adbClient.getPowerState();
      if (adbPower !== null && adbPower !== this.isPowerOn) {
        this.isPowerOn = adbPower;
        this.tvService.updateCharacteristic(this.platform.Characteristic.Active, adbPower ? 1 : 0);
      }
    }

    if (!this.isPowerOn) {
      return;
    }
    
    if (this.bulbService) {
      try {
        const vol = await this.castClient.getVolume();
        if (vol && typeof vol.level === 'number') {
          this.bulbService.updateCharacteristic(this.platform.Characteristic.Brightness, Math.round(vol.level * 100));
        }
      } catch { /* ignore */ }

      try {
        const mediaState = this.mediaStateManager.getResolvedPlaybackState();
        this.bulbService.updateCharacteristic(this.platform.Characteristic.On, mediaState.state === 'PLAYING');
      } catch { /* ignore */ }
    }
  }

  getPreviousIp(): string {
    return this.tvAccessory.context.device.ip;
  }

  updateIpAndPort(newIp: string, newAdbPort?: number) {
    if (this.tvAccessory.context.device.ip === newIp && 
        (!this.adbClient || !newAdbPort || this.adbClient.port === newAdbPort)) {
      return; // No change
    }
    
    this.platform.log.info(`[TelevisionAccessory] Hot-swapping IP/Port to ${newIp}:${newAdbPort || ''}`);
    
    // Update internal context
    this.tvAccessory.context.device.ip = newIp;
    if (this.bulbAccessory) {
      this.bulbAccessory.context.device.ip = newIp;
    }

    // Update Clients
    this.castClient.ip = newIp;
    this.androidTVClient.updateIp(newIp);
    if (this.adbClient) {
      this.adbClient.ip = newIp;
      if (newAdbPort) {
        this.adbClient.port = newAdbPort;
        this.adbClient.endpoint = `${newIp}:${newAdbPort}`;
      }
    }

    // Try reconnecting
    this.connect();
  }
}
