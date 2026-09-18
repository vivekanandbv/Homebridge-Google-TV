/* eslint-disable @typescript-eslint/no-explicit-any */
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TelevisionAccessory } from './homekit/TelevisionAccessory.js';
import { DiscoveryEngine, DiscoveredDevice } from './discovery/mdns.js';

export class ADBCastPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly tvAccessories: Map<string, TelevisionAccessory> = new Map();
  private discovery: DiscoveryEngine;
  private activeDevicesByIp: Set<string> = new Set();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.discovery = new DiscoveryEngine();

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      
      const devices = this.config.devices || [];
      const validBulbUuids = new Set<string>();

      // 1. Identify all valid lightbulb UUIDs for configured devices
      for (const device of devices) {
        if (device.ip) {
          const deviceId = device.id || (device.ip + '_static');
          const bulbUuid = this.api.hap.uuid.generate(deviceId + '_volbulb_v1');
          if (!device.disableVolumeBulb) {
            validBulbUuids.add(bulbUuid);
          }
        }
      }

      // 2. Remove orphaned, unconfigured, or disabled cached accessories
      for (const [uuid, cachedAccessory] of this.accessories.entries()) {
        if (!validBulbUuids.has(uuid)) {
          this.log.info(`[Platform] Removing unconfigured or disabled cached accessory: ${cachedAccessory.displayName}`);
          try {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
          } catch (e) {
            this.log.debug(`Failed to unregister accessory ${cachedAccessory.displayName}:`, e);
          }
          this.accessories.delete(uuid);
        }
      }

      // 3. Initialize explicitly configured devices
      for (const device of devices) {
        if (device.ip) {
          this.log.info(`[Platform] Initializing configured device on startup: ${device.name || 'Google TV'} (${device.ip})`);
          this.setupConfiguredDevice(device);
        }
      }

      // 4. Listen for mDNS updates ONLY for configured devices (do not auto-add random LAN devices)
      this.discovery.on('device_updated', this.onDeviceUpdated.bind(this));
      this.discovery.on('device_discovered', (discovered: DiscoveredDevice) => {
        const match = devices.find((d: any) => d.ip === discovered.ip || (d.id && d.id === discovered.id));
        if (match) {
          this.onDeviceUpdated(discovered);
        } else {
          this.log.debug(`[Platform] Ignoring unconfigured Cast device on network: ${discovered.name} (${discovered.ip})`);
        }
      });
      this.discovery.start();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  setupConfiguredDevice(device: any) {
    if (this.activeDevicesByIp.has(device.ip)) {
      return;
    }
    this.activeDevicesByIp.add(device.ip);

    const deviceId = device.id || (device.ip + '_static');
    const displayName = device.name || 'Google TV';

    // 1. Setup the TV Accessory (External)
    const tvUuid = this.api.hap.uuid.generate(deviceId + '_tv_v4');
    const tvAccessory = new this.api.platformAccessory(displayName, tvUuid, this.api.hap.Categories.TELEVISION);
    tvAccessory.context.device = { id: deviceId, name: displayName, ip: device.ip };

    // 2. Setup the Volume Dimmer Lightbulb (Bridged) if enabled
    let bulbAccessory: PlatformAccessory | undefined;
    if (!device.disableVolumeBulb) {
      const bulbUuid = this.api.hap.uuid.generate(deviceId + '_volbulb_v1');
      bulbAccessory = this.accessories.get(bulbUuid);

      if (!bulbAccessory) {
        this.log.info('Adding Volume Dimmer Lightbulb:', displayName + ' Volume');
        bulbAccessory = new this.api.platformAccessory(displayName + ' Volume', bulbUuid, this.api.hap.Categories.LIGHTBULB);
        bulbAccessory.context.device = { id: deviceId, name: displayName + ' Volume', ip: device.ip };
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [bulbAccessory]);
        this.accessories.set(bulbUuid, bulbAccessory);
      } else {
        this.log.info('Restoring Volume Dimmer Lightbulb from cache:', bulbAccessory.displayName);
        bulbAccessory.context.device = { id: deviceId, name: displayName + ' Volume', ip: device.ip };
        this.api.updatePlatformAccessories([bulbAccessory]);
      }
    }

    const tvAccObj = new TelevisionAccessory(this, tvAccessory, bulbAccessory, device.ip);
    this.tvAccessories.set(deviceId, tvAccObj);

    try {
      this.api.publishExternalAccessories(PLUGIN_NAME, [tvAccessory]);
    } catch (e) {
      this.log.error('Failed to publish external TV accessory:', e);
    }
  }

  onDeviceUpdated(device: DiscoveredDevice) {
    this.log.info(`[Platform] Device updated via mDNS: ${device.name} (IP: ${device.ip}, ADB Port: ${device.adbPort || 'N/A'})`);
    
    // Find if we have an active TelevisionAccessory for this device ID or IP
    const tvAcc = this.tvAccessories.get(device.id) || Array.from(this.tvAccessories.values()).find(acc => acc.getPreviousIp() === device.ip);
    if (tvAcc) {
      tvAcc.updateIpAndPort(device.ip, device.adbPort);
    }
  }
}
