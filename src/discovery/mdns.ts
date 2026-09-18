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
    try {
      this.bonjour = new Bonjour({}, (err: unknown) => {
        console.warn('[DiscoveryEngine] Bonjour mDNS warning/error:', err instanceof Error ? err.message : String(err));
      });
      const internalServer = (this.bonjour as any).server;
      if (internalServer && internalServer.mdns && typeof internalServer.mdns.on === 'function') {
        internalServer.mdns.on('error', (err: unknown) => {
          console.warn('[DiscoveryEngine] mDNS socket error ignored:', err instanceof Error ? err.message : String(err));
        });
      }
    } catch (e: unknown) {
      console.warn('[DiscoveryEngine] Failed to initialize Bonjour safely:', e instanceof Error ? e.message : String(e));
      this.bonjour = new Bonjour();
    }
  }

  start() {
    try {
      this.browser = this.bonjour.find({ type: 'googlecast' });
      if (this.browser) {
        this.browser.on('up', this.onServiceUp.bind(this));
        this.browser.on('error', (err: unknown) => {
          console.warn('[DiscoveryEngine] GoogleCast browser error:', err instanceof Error ? err.message : String(err));
        });
        this.browser.start();
      }

      this.adbBrowser = this.bonjour.find({ type: 'adb-tls-connect' });
      if (this.adbBrowser) {
        this.adbBrowser.on('up', this.onAdbServiceUp.bind(this));
        this.adbBrowser.on('error', (err: unknown) => {
          console.warn('[DiscoveryEngine] ADB browser error:', err instanceof Error ? err.message : String(err));
        });
        this.adbBrowser.start();
      }
    } catch (e: unknown) {
      console.warn('[DiscoveryEngine] Error starting mDNS browsers:', e instanceof Error ? e.message : String(e));
    }
  }

  stop() {
    try {
      if (this.browser) {
        this.browser.stop();
      }
      if (this.adbBrowser) {
        this.adbBrowser.stop();
      }
      this.bonjour.destroy();
    } catch (e: unknown) {
      console.warn('[DiscoveryEngine] Error stopping Bonjour:', e instanceof Error ? e.message : String(e));
    }
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
      // Silent ignore for non-Chromecast devices
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
