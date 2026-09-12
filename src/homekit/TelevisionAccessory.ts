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

const appPackageMap: { [key: string]: { package: string, type: number, key?: number } } = {
  'Home': { package: 'com.google.android.apps.tv.referencelauncher', type: 1, key: 3 },
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
  private bulbService: Service;
  private castClient: CastClient;
  private androidTVClient: AndroidTVClient;
  private adbClient?: ADBClient;
  private mediaStateManager: MediaStateManager;
  private isPowerOn = false;
  private currentInputId = 1;
  private inputServices: Service[] = [];

  constructor(
    private readonly platform: ADBCastPlatform,
    private readonly tvAccessory: PlatformAccessory,
    private readonly bulbAccessory: PlatformAccessory,
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
          this.platform.log.info(`[ADBClient] ${msg}`);
        }
      });
    }
    
    this.mediaStateManager = new MediaStateManager(this.castClient, this.androidTVClient, this.adbClient);

    this.androidTVClient.on("error", (err) => {
      this.platform.log.debug(`[AndroidTVClient] Background connection error: ${err.message}`);
    });

    this.castClient.on("error", (err) => {
      this.platform.log.debug(`[CastClient] Background connection error: ${err.message}`);
    });


    this.androidTVClient.on('ready', () => {
      this.platform.log.info(`[AndroidTV] Successfully paired and connected to ${ip}`);
    });

    this.androidTVClient.on('powered', (powered: boolean) => {
      this.platform.log.info(`[AndroidTV] Live power state updated: ${powered ? 'ON' : 'OFF'}`);
      this.isPowerOn = powered;
      this.tvService.updateCharacteristic(this.platform.Characteristic.Active, powered ? 1 : 0);
    });

    this.tvAccessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Google')
      .setCharacteristic(this.platform.Characteristic.Model, 'Chromecast HD TV')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, tvAccessory.context.device.id);

    this.bulbAccessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Google')
      .setCharacteristic(this.platform.Characteristic.Model, 'Volume Dimmer Lightbulb')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, bulbAccessory.context.device.id);

    // 1. Setup primary Television Service on the TV Accessory
    this.tvService = this.tvAccessory.getService(this.platform.Service.Television)
      || this.tvAccessory.addService(this.platform.Service.Television, tvAccessory.context.device.name);

    this.tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, tvAccessory.context.device.name);
    this.tvService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    this.tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(async (value) => {
        this.platform.log.info(`[TV Power] Set Active -> ${value === 1 ? 'ON' : 'OFF'}`);
        if (value === 1) {
          await this.androidTVClient.powerOn();
        } else {
          await this.androidTVClient.powerOff();
        }
      })
      .onGet(async () => {
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
      || this.tvAccessory.addService(this.platform.Service.TelevisionSpeaker, tvAccessory.context.device.name + ' Speaker');

    this.speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.RELATIVE);

    this.speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet(async (value) => {
        const selector = value as number;
        if (selector === this.platform.Characteristic.VolumeSelector.INCREMENT) {
          this.platform.log.info('[TV Speaker] Volume Up');
          await this.androidTVClient.sendKey(24);
        } else {
          this.platform.log.info('[TV Speaker] Volume Down');
          await this.androidTVClient.sendKey(25);
        }
      });

    this.speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onSet(async (value) => {
        this.platform.log.info(`[TV Speaker] Set Mute -> ${value}`);
        await this.androidTVClient.setMuted(value as boolean);
      });

    this.setupInputSources();

    // 3. Setup the volume/playback Lightbulb service on the Bulb Accessory
    this.bulbService = this.bulbAccessory.getService(this.platform.Service.Lightbulb)
      || this.bulbAccessory.addService(this.platform.Service.Lightbulb, bulbAccessory.context.device.name);

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
        } catch (e) { /* ignore */ }
        return 0;
      });

    // 4. Sync media state updates to the Bulb accessory (so it responds to physical remote clicks)
    this.mediaStateManager.on('state_changed', () => {
      try {
        const mediaState = this.mediaStateManager.getResolvedPlaybackState();
        this.platform.log.info(`[PlaybackState] Resolved: ${mediaState.state} (Source: ${mediaState.source})`);
        this.bulbService.updateCharacteristic(this.platform.Characteristic.On, mediaState.state === 'PLAYING');
      } catch (e) { /* ignore */ }
    });

    this.connect();
    setInterval(() => this.updateState(), 10000);
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
    const localAppMap = { ...appPackageMap };
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
        .setCharacteristic(this.platform.Characteristic.InputSourceType, target.type);

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
      if (inputName === 'Home') {
        await this.androidTVClient.sendKey(3); // Go Home
        return;
      }
      
      if (this.adbClient && this.adbClient.isConnected && this.adbClient.targetIdentifier) {
        this.platform.log.info(`[TV Input] Launching app ${inputName} (${target.package}) over ADB`);
        await execAsync(`${adbPath} -s ${this.adbClient.targetIdentifier} shell monkey -p ${target.package} -c android.intent.category.LEANBACK_LAUNCHER 1`);
      } else {
        this.platform.log.warn(`[TV Input] ADB not connected, cannot launch ${inputName}`);
      }
    } catch (e: any) {
      this.platform.log.error(`[TV Input] Failed to launch app ${inputName}: ${e.message}`);
    }
  }

  private async handleRemoteKey(key: number) {
    const Char = this.platform.Characteristic;
    switch (key) {
    case Char.RemoteKey.REWIND:
      await this.androidTVClient.sendKey(89);
      break;
    case Char.RemoteKey.FAST_FORWARD:
      await this.androidTVClient.sendKey(90);
      break;
    case Char.RemoteKey.NEXT_TRACK:
      await this.androidTVClient.sendKey(87);
      break;
    case Char.RemoteKey.PREVIOUS_TRACK:
      await this.androidTVClient.sendKey(88);
      break;
    case Char.RemoteKey.ARROW_UP:
      await this.androidTVClient.sendKey(19);
      break;
    case Char.RemoteKey.ARROW_DOWN:
      await this.androidTVClient.sendKey(20);
      break;
    case Char.RemoteKey.ARROW_LEFT:
      await this.androidTVClient.sendKey(21);
      break;
    case Char.RemoteKey.ARROW_RIGHT:
      await this.androidTVClient.sendKey(22);
      break;
    case Char.RemoteKey.SELECT:
      await this.androidTVClient.sendKey(66);
      break;
    case Char.RemoteKey.BACK:
      await this.androidTVClient.sendKey(4);
      break;
    case Char.RemoteKey.EXIT:
      await this.androidTVClient.sendKey(4);
      break;
    case Char.RemoteKey.PLAY_PAUSE:
      await this.androidTVClient.sendKey(85);
      break;
    case Char.RemoteKey.INFORMATION:
      await this.androidTVClient.sendKey(82);
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

    if (anyConnected) {
      this.isPowerOn = true;
      this.updateState();
    } else {
      this.platform.log.error('Both CastClient and AndroidTVClient failed to connect.');
      this.isPowerOn = false;
    }
  }

  async updateState() {
    if (!this.isPowerOn) {
      return;
    }
    
    try {
      const vol = await this.castClient.getVolume();
      if (vol && typeof vol.level === 'number') {
        this.bulbService.updateCharacteristic(this.platform.Characteristic.Brightness, Math.round(vol.level * 100));
      }
    } catch (e) { /* ignore */ }

    try {
      const mediaState = this.mediaStateManager.getResolvedPlaybackState();
      this.bulbService.updateCharacteristic(this.platform.Characteristic.On, mediaState.state === 'PLAYING');
    } catch (e) { /* ignore */ }
  }
}
