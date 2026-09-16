/* eslint-disable @typescript-eslint/no-explicit-any */
import './protoFix.js';
import { PersistentClient, createPlatform, DefaultMediaApp, ReceiverController } from '@foxxmd/chromecast-client';
import { EventEmitter } from 'events';

export class CastClient extends EventEmitter {
  private client: PersistentClient;
  private platform: any;
  public ip: string;

  constructor(ip: string) {
    super();
    this.ip = ip;
    this.client = new PersistentClient({ host: ip });
    
    this.client.on('connect', () => this.emit('connect'));
    this.client.on('error', (err) => this.emit('error', err));
    this.client.on('close', () => this.emit('close'));
  }

  async connect() {
    await this.client.connect();
    this.platform = await createPlatform(this.client);
  }

  async disconnect() {
    if (this.platform) {
      this.platform.close();
    }
    this.client.close();
  }

  async powerOn() {
    try {
      if (!this.client) {
        return;
      }
      // Launching an app wakes up the TV via HDMI-CEC
      await DefaultMediaApp.launchAndJoin({ client: this.client });
    } catch (e) {
      console.error('Failed to power on', e);
    }
  }

  async powerOff() {
    try {
      if (!this.client) {
        return;
      }
      const controller = ReceiverController.createReceiver({ client: this.client });
      const status = (await controller.getStatus()).unwrapAndThrow();
      const sessionId = status.applications?.[0]?.sessionId;
      if (sessionId) {
        await controller.stop(sessionId);
      }
      controller.dispose();
    } catch (e) {
      console.error('Failed to power off', e);
    }
  }

  async getVolume(): Promise<{ level: number, muted: boolean }> {
    if (!this.platform) {
      throw new Error('Not connected');
    }
    const vol = await this.platform.getVolume();
    return { level: vol.value.value.level, muted: vol.value.value.muted };
  }

  async setVolume(level: number): Promise<void> {
    if (!this.platform) {
      throw new Error('Not connected');
    }
    await this.platform.setVolume(level);
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.platform) {
      throw new Error('Not connected');
    }
    await this.platform.setMuted(muted);
  }

  async getStatus(): Promise<any> {
    if (!this.platform) {
      throw new Error('Not connected');
    }
    return await this.platform.getStatus();
  }
}
