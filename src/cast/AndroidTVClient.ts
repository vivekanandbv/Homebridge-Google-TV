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

  public get isRemoteConnected(): boolean {
    return this.isConnected;
  }

  public get hasValidCert(): boolean {
    return !!(
      this.cert &&
      typeof this.cert.key === 'string' &&
      typeof this.cert.cert === 'string' &&
      this.cert.key.includes('BEGIN') &&
      this.cert.cert.includes('BEGIN')
    );
  }

  constructor(ip: string, pairingCode?: string, cert?: any) {
    super();
    this.ip = ip;
    this.pairingCode = pairingCode;
    this.cert = cert;

    const validCert = this.hasValidCert ? this.cert : {};

    this.options = {
      pairing_port: 6467,
      remote_port: 6466,
      name: 'homebridge-google-tv',
      cert: validCert,
    };

    this.remote = new AndroidRemote(this.ip, this.options);
    this.bindRemoteEvents();
  }

  private bindRemoteEvents() {
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

    this.remote.on('unpaired', () => {
      this.isConnected = false;
      this.emit('unpaired');
    });

    this.remote.on('error', (err: any) => {
      const isReject =
        err?.error?.message?.remoteConfigure?.code1 === 622 ||
        err?.error?.value === true ||
        err?.message?.includes('622');
      if (isReject) {
        this.isConnected = false;
        this.emit('unpaired');
      }
      this.emit('error', err);
    });
  }

  updateIp(newIp: string) {
    if (this.ip === newIp) {
      return;
    }
    this.ip = newIp;
    this.disconnect();

    const validCert = this.hasValidCert ? this.cert : {};
    this.options.cert = validCert;
    this.remote = new AndroidRemote(this.ip, this.options);
    this.bindRemoteEvents();
  }

  async connect() {
    if (this.isConnected) {
      return;
    }
    if (!this.hasValidCert) {
      this.isConnected = false;
      return;
    }
    try {
      await this.remote.start();
    } catch (e) {
      this.isConnected = false;
      console.error('[AndroidTV] Start error:', e);
      throw e;
    }
  }

  async disconnect() {
    try {
      this.remote.stop();
    } catch { /* ignore */ }
    this.isConnected = false;
  }

  async powerOn(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    try {
      return await this.sendKey(26); // KEYCODE_POWER
    } catch {
      return false;
    }
  }

  async powerOff(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    try {
      return await this.sendKey(26); // KEYCODE_POWER
    } catch {
      return false;
    }
  }

  async setVolume(level: number) {
    console.log(`[AndroidTV] Requested volume set to ${level}, which is unsupported via standard directional remote API.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setMuted(muted: boolean): Promise<boolean> {
    return this.sendKey(RemoteKeyCode.KEYCODE_MUTE);
  }

  async sendKey(keyCode: number): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    try {
      this.remote.sendKey(keyCode, 1); // RemoteDirection.START_LONG
      setTimeout(() => {
        try {
          this.remote.sendKey(keyCode, 2); // RemoteDirection.END_LONG
        } catch { /* ignore */ }
      }, 100);
      return true;
    } catch {
      return false;
    }
  }
}
