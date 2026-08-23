/* eslint-disable @typescript-eslint/no-explicit-any */
import { AndroidRemote, RemoteKeyCode } from 'androidtv-remote';
import { EventEmitter } from 'events';

export class AndroidTVClient extends EventEmitter {
  private remote: any;
  public ip: string;
  private isConnected = false;
  private pairingCode?: string;
  private cert?: any;
  private options: any;
  private isPowerOnState = false;

  public get isPowerOn(): boolean {
    return this.isPowerOnState;
  }

  constructor(ip: string, pairingCode?: string, cert?: any) {
    super();
    this.ip = ip;
    this.pairingCode = pairingCode;
    this.cert = cert;

    this.options = {
      pairing_port: 6467,
      remote_port: 6466,
      name: 'homebridge-adb-cast',
      cert: this.cert || {},
    };

    this.remote = new AndroidRemote(this.ip, this.options);

    this.remote.on('secret', () => {
      this.emit('pairing_requested');
      if (this.pairingCode) {
        this.remote.sendCode(this.pairingCode);
      } else {
        console.error(`[AndroidTV] Pairing requested for ${this.ip}, but no pairingCode provided in config!`);
      }
    });

    this.remote.on('powered', (powered: boolean) => {
      this.isPowerOnState = powered;
      this.emit('powered', powered);
    });

    this.remote.on('volume', (volume: any) => {
      this.emit('volume', volume);
    });

    this.remote.on('ready', () => {
      this.isConnected = true;
      this.cert = this.remote.getCertificate();
      this.emit('ready', this.cert);
    });

    this.remote.on('error', (err: any) => {
      console.error('[AndroidTV] Error:', err);
      this.emit('error', err);
    });
  }

  async connect() {
    if (this.isConnected) {
      return;
    }
    try {
      await this.remote.start();
    } catch (e) {
      console.error('[AndroidTV] Start error:', e);
      throw e;
    }
  }

  async disconnect() {
    this.remote.stop();
    this.isConnected = false;
  }

  async powerOn() {
    if (!this.isPowerOnState) {
      await this.sendKey(26); // KEYCODE_POWER (Toggle ON)
    }
  }

  async powerOff() {
    if (this.isPowerOnState) {
      await this.sendKey(26); // KEYCODE_POWER (Toggle OFF)
    }
  }

  async setVolume(level: number) {
    console.log(`[AndroidTV] Requested volume set to ${level}, which is unsupported via standard directional remote API.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setMuted(muted: boolean) {
    this.sendKey(RemoteKeyCode.KEYCODE_MUTE);
  }

  async sendKey(keyCode: number) {
    // Send a press down, wait 100ms, then release. 
    // This perfectly emulates a human button press and solves ignored "Short" commands.
    this.remote.sendKey(keyCode, 1); // RemoteDirection.START_LONG
    setTimeout(() => {
      this.remote.sendKey(keyCode, 2); // RemoteDirection.END_LONG
    }, 100);
  }
}
