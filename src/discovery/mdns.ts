/* eslint-disable @typescript-eslint/no-explicit-any */
import Bonjour, { Service } from 'bonjour-service';
import { EventEmitter } from 'events';

export interface DiscoveredDevice {
  id: string;
  name: string;
  model: string;
  ip: string;
  port: number;
  txt: any;
  adbPort?: number;
}

export class DiscoveryEngine extends EventEmitter {
  private bonjour: Bonjour;
  private browser: any;
  private adbBrowser: any;
  private devices: Map<string, DiscoveredDevice> = new Map();
  private adbPortsByIp: Map<string, number> = new Map();

  constructor() {
    super();
    this.bonjour = new Bonjour();
  }

  start() {
    this.browser = this.bonjour.find({ type: 'googlecast' });
    this.browser.on('up', this.onServiceUp.bind(this));
    this.browser.start();

    this.adbBrowser = this.bonjour.find({ type: 'adb-tls-connect' });
    this.adbBrowser.on('up', this.onAdbServiceUp.bind(this));
    this.adbBrowser.start();
  }

  stop() {
    if (this.browser) {
      this.browser.stop();
    }
    if (this.adbBrowser) {
      this.adbBrowser.stop();
    }
    this.bonjour.destroy();
  }

  private onAdbServiceUp(service: Service) {
    const ip = service.addresses?.find(addr => addr.includes('.')) || service.addresses?.[0];
    if (!ip) {
      return; 
    }
    this.adbPortsByIp.set(ip, service.port);

    // If we already discovered the Cast device at this IP, emit an update
    for (const device of this.devices.values()) {
      if (device.ip === ip && device.adbPort !== service.port) {
        device.adbPort = service.port;
        this.emit('device_updated', device);
        break;
      }
    }
  }

  private onServiceUp(service: Service) {
    const txt = service.txt as any;
    if (!txt || !txt.id) {
      return;
    }
    
    const ip = service.addresses?.find(addr => addr.includes('.')) || service.addresses?.[0];
    if (!ip) {
      return;
    }

    const model = txt.md || 'Unknown';
    const name = txt.fn || service.name;

    // Filter out Tata Play set-top boxes as requested by user
    if (model.toLowerCase().includes('tata sky') || name.toLowerCase().includes('tata play')) {
      console.log(`[DiscoveryEngine] Ignoring non-Chromecast device: ${name} (${model})`);
      return;
    }

    const adbPort = this.adbPortsByIp.get(ip);

    const device: DiscoveredDevice = {
      id: txt.id,
      name: name,
      model: model,
      ip: ip,
      port: service.port,
      txt: txt,
      adbPort: adbPort,
    };

    const existing = this.devices.get(device.id);
    this.devices.set(device.id, device);

    if (existing && (existing.ip !== device.ip || existing.adbPort !== device.adbPort)) {
      this.emit('device_updated', device);
    } else if (!existing) {
      this.emit('device_discovered', device);
    }
  }
}
