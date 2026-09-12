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
      
      // Load all configured devices on startup immediately
      const devices = this.config.devices || [];
      for (const device of devices) {
        if (device.ip) {
          const deviceId = device.id || (device.ip + '_static');
          
          // Cleanup old accessories from previous architecture if they exist in cache
          const oldUuids = [
            this.api.hap.uuid.generate(deviceId + '_controls_v1'),
            this.api.hap.uuid.generate(deviceId + '_static_controls_v1'),
            this.api.hap.uuid.generate(deviceId + '_static_v5'),
            this.api.hap.uuid.generate(device.ip + '_static_v5'),
            this.api.hap.uuid.generate(device.ip + '_static_controls_v1'),
            this.api.hap.uuid.generate(device.ip + '_controls_v1'),
            this.api.hap.uuid.generate(deviceId + '_lightbulb_v2'),
            this.api.hap.uuid.generate(device.ip + '_lightbulb_v2'),
          ];
          
          for (const oldUuid of oldUuids) {
            const oldAccessory = this.accessories.get(oldUuid);
            if (oldAccessory) {
              this.log.info(`[Platform] Cleaning up old cached accessory: ${oldAccessory.displayName}`);
              try {
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [oldAccessory]);
              } catch (e) { /* ignore */ }
              this.accessories.delete(oldUuid);
            }
          }
          
          this.log.info(`[Platform] Initializing configured device on startup: ${device.name || 'Google TV'} (${device.ip})`);
          this.setupConfiguredDevice(device);
        }
      }

      this.discovery.on('device_discovered', this.onDeviceDiscovered.bind(this));
      this.discovery.on('device_updated', this.onDeviceUpdated.bind(this));
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

    // 2. Setup the Volume Dimmer Lightbulb (Bridged)
    const bulbUuid = this.api.hap.uuid.generate(deviceId + '_volbulb_v1');
    let bulbAccessory = this.accessories.get(bulbUuid);

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

    const tvAccObj = new TelevisionAccessory(this, tvAccessory, bulbAccessory, device.ip);
    this.tvAccessories.set(deviceId, tvAccObj);

    try {
      this.api.publishExternalAccessories(PLUGIN_NAME, [tvAccessory]);
    } catch (e) {
      this.log.error('Failed to publish external TV accessory:', e);
    }
  }

  onDeviceDiscovered(device: DiscoveredDevice) {
    if (this.activeDevicesByIp.has(device.ip)) {
      this.log.info(`[Platform] Discovered device ${device.name} via mDNS, but it is already active. Ignoring.`);
      return;
    }
    this.activeDevicesByIp.add(device.ip);

    const uuid = this.api.hap.uuid.generate(device.id + '_tv_v4');
    const displayName = device.name;
    this.log.info('Publishing newly discovered accessory as a Television:', displayName);
    const tvAccessory = new this.api.platformAccessory(displayName, uuid, this.api.hap.Categories.TELEVISION);
    tvAccessory.context.device = device;

    // Setup the Volume Dimmer Lightbulb (Bridged)
    const bulbUuid = this.api.hap.uuid.generate(device.id + '_volbulb_v1');
    let bulbAccessory = this.accessories.get(bulbUuid);

    if (!bulbAccessory) {
      this.log.info('Adding Volume Dimmer Lightbulb:', displayName + ' Volume');
      bulbAccessory = new this.api.platformAccessory(displayName + ' Volume', bulbUuid, this.api.hap.Categories.LIGHTBULB);
      bulbAccessory.context.device = { id: device.id, name: displayName + ' Volume', ip: device.ip };
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [bulbAccessory]);
      this.accessories.set(bulbUuid, bulbAccessory);
    } else {
      this.log.info('Restoring Volume Dimmer Lightbulb from cache:', bulbAccessory.displayName);
      bulbAccessory.context.device = { id: device.id, name: displayName + ' Volume', ip: device.ip };
      this.api.updatePlatformAccessories([bulbAccessory]);
    }

    const tvAccObj = new TelevisionAccessory(this, tvAccessory, bulbAccessory, device.ip);
    this.tvAccessories.set(device.id, tvAccObj);

    try {
      this.api.publishExternalAccessories(PLUGIN_NAME, [tvAccessory]);
    } catch (e) {
      this.log.error('Failed to publish external TV accessory:', e);
    }
  }

  onDeviceUpdated(device: DiscoveredDevice) {
    this.log.info(`[Platform] Device updated via mDNS: ${device.name} (IP: ${device.ip}, ADB Port: ${device.adbPort || 'N/A'})`);
    
    // Find if we have an active TelevisionAccessory for this device ID
    const tvAcc = this.tvAccessories.get(device.id);
    if (tvAcc) {
      tvAcc.updateIpAndPort(device.ip, device.adbPort);
      // Context changes are automatically saved by Homebridge to cachedAccessories
    }
  }
}
