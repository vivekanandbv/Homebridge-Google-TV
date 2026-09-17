/* eslint-disable @typescript-eslint/no-explicit-any */
import './protoFix.js';
import { PersistentClient, createPlatform, DefaultMediaApp, ReceiverController } from '@foxxmd/chromecast-client';
import { EventEmitter } from 'events';

export class CastClient extends EventEmitter {
  private client: PersistentClient;
  private platform: any;
  public ip: string;
  public isConnected = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastVolume = { level: 0.5, muted: false };

  constructor(ip: string) {
    super();
    this.ip = ip;
    this.client = new PersistentClient({ host: ip, retryDelay: 5000, timeout: 5000 });
    
    this.client.on('connect', async () => {
      this.isConnected = true;
      try {
        this.platform = await createPlatform(this.client);
      } catch {
        // Platform re-creation will retry on next command
      }
      this.emit('connect');
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.emit('close');
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      this.emit('error', err);
    });

    // Start 15s Heartbeat Ping to prevent Chromecast idle TLS socket timeout in sleep/standby
    this.startHeartbeat();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.client) {
        try {
          this.client.send(
            'sender-0',
            'receiver-0',
            'urn:x-cast:com.google.cast.tp.heartbeat',
            JSON.stringify({ type: 'PING' }),
          );
        } catch {
          // Socket might be reconnecting
        }
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  async connect() {
    try {
      await this.client.connect();
      this.isConnected = true;
      this.platform = await createPlatform(this.client);
    } catch (e) {
      this.isConnected = false;
      throw e;
    }
  }

  async disconnect() {
    this.stopHeartbeat();
    if (this.platform) {
      try {
        this.platform.close();
      } catch { /* ignore */ }
    }
    try {
      this.client.close();
    } catch { /* ignore */ }
    this.isConnected = false;
  }

  async powerOn() {
    try {
      if (!this.client) {
        return;
      }
      // Launching an app wakes up the TV via HDMI-CEC
      await DefaultMediaApp.launchAndJoin({ client: this.client });
    } catch (e) {
      console.error('[CastClient] Failed to power on via Cast:', e);
    }
  }

  async powerOff() {
    try {
      if (!this.client || !this.isConnected) {
        return;
      }
      const controller = ReceiverController.createReceiver({ client: this.client });
      const statusRes = await controller.getStatus();
      const status = statusRes.unwrapAndThrow();
      const sessionId = status.applications?.[0]?.sessionId;
      if (sessionId) {
        await controller.stop(sessionId);
      }
      controller.dispose();
    } catch {
      // Ignored during normal power-off
    }
  }

  async getVolume(): Promise<{ level: number, muted: boolean }> {
    if (!this.isConnected || !this.platform) {
      return this.lastVolume;
    }

    try {
      const vol = await Promise.race([
        this.platform.getVolume(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Cast getVolume timeout')), 2500)),
      ]);
      if (vol && vol.value && vol.value.value) {
        this.lastVolume = {
          level: vol.value.value.level,
          muted: vol.value.value.muted,
        };
      }
      return this.lastVolume;
    } catch {
      // Return last known volume when device is in semi-sleep or socket is cycling
      return this.lastVolume;
    }
  }

  async setVolume(level: number): Promise<void> {
    if (!this.platform || !this.isConnected) {
      return;
    }
    try {
      await this.platform.setVolume(level);
      this.lastVolume.level = level;
    } catch (e) {
      console.error('[CastClient] setVolume error:', e);
    }
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.platform || !this.isConnected) {
      return;
    }
    try {
      await this.platform.setMuted(muted);
      this.lastVolume.muted = muted;
    } catch (e) {
      console.error('[CastClient] setMuted error:', e);
    }
  }

  async getStatus(): Promise<any> {
    if (!this.platform || !this.isConnected) {
      return null;
    }
    try {
      return await Promise.race([
        this.platform.getStatus(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Cast getStatus timeout')), 2500)),
      ]);
    } catch {
      return null;
    }
  }
}
