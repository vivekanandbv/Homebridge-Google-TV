/* global process, setTimeout, clearTimeout, console */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import Bonjour from 'bonjour-service';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync } from 'fs';
import androidtvRemote from 'androidtv-remote';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function isAdbWorking(cmd) {
  try {
    await execAsync(`"${cmd}" --version`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function tryAutoInstallAdb() {
  if (process.platform !== 'linux') {
    return;
  }

  // 1. Alpine Linux (Docker container on Synology DSM)
  if (existsSync('/etc/alpine-release')) {
    try {
      console.log('[ADBCast UI] Attempting to auto-install android-tools via apk...');
      try {
        await execAsync('sudo -n apk add --no-cache android-tools', { timeout: 30000 });
      } catch {
        await execAsync('apk add --no-cache android-tools', { timeout: 30000 });
      }
    } catch (e) {
      console.error('[ADBCast UI] apk auto-install failed:', e.message);
    }
    return;
  }

  // 2. Debian / Ubuntu
  if (existsSync('/etc/debian_version')) {
    try {
      console.log('[ADBCast UI] Attempting to auto-install adb via apt-get...');
      try {
        await execAsync(
          'sudo -n apt-get update -qq && (sudo -n apt-get install -y -qq adb || sudo -n apt-get install -y -qq android-tools-adb)',
          { timeout: 60000 },
        );
      } catch {
        await execAsync(
          'apt-get update -qq && (apt-get install -y -qq adb || apt-get install -y -qq android-tools-adb)',
          { timeout: 60000 },
        );
      }
    } catch (e) {
      console.error('[ADBCast UI] apt-get auto-install failed:', e.message);
    }
  }
}

let autoInstallAttempted = false;

async function getAdbPath() {
  const localAdb = path.join(__dirname, '..', 'bin', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const paths = [
    localAdb,
    '/usr/bin/adb',
    '/usr/local/bin/adb',
    '/opt/homebrew/bin/adb',
    'adb',
  ];

  for (const p of paths) {
    if (await isAdbWorking(p)) {
      return p;
    }
  }

  if (!autoInstallAttempted) {
    autoInstallAttempted = true;
    await tryAutoInstallAdb();

    for (const p of paths) {
      if (await isAdbWorking(p)) {
        return p;
      }
    }
  }

  return null;
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.bonjour = new Bonjour.Bonjour();
    
    // Debug endpoint
    this.onRequest('/debug', this.debugWrite.bind(this));

    // Check ADB status
    this.onRequest('/check-adb', this.checkAdb.bind(this));
    // API endpoint for discovering devices
    this.onRequest('/discover', this.discoverDevices.bind(this));
    
    // API endpoint for pairing ADB
    this.onRequest('/pair-adb', this.pairAdb.bind(this));
    
    // API endpoint for deleting/disconnecting ADB
    this.onRequest('/delete-device', this.deleteDevice.bind(this));
    
    // API endpoint for pairing Android TV Remote
    this.onRequest('/start-remote-pairing', this.startRemotePairing.bind(this));
    this.onRequest('/submit-remote-pin', this.submitRemotePin.bind(this));
    
    // API endpoint for restarting Homebridge
    this.onRequest('/restart-homebridge', this.restartHomebridge.bind(this));

    this.ready();
  }
  
  async deleteDevice(payload) {
    const { ip, adbIpPort } = payload;
    try {
      const adb = await getAdbPath();
      if (adb) {
        if (ip) {
          try {
            await execAsync(`"${adb}" disconnect ${ip}`); 
          } catch { /* ignore */ }
        }
        if (adbIpPort) {
          try {
            await execAsync(`"${adb}" disconnect ${adbIpPort}`); 
          } catch { /* ignore */ }
        }
      }
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
  
  async debugWrite(payload) {
    writeFileSync('/tmp/hb_ui_debug.json', JSON.stringify(payload, null, 2));
    return { ok: true };
  }

  async checkAdb() {
    try {
      const adb = await getAdbPath();
      if (!adb) {
        return { connected: false, error: 'ADB is not installed on this host.' };
      }
      const { stdout } = await execAsync(`"${adb}" devices -l`, { timeout: 3000 });
      const lines = stdout.split('\n').filter(l => l.includes('device ') && !l.startsWith('List'));
      if (lines.length > 0) {
        // Try to get the TV's IP address via adb shell
        let ip = null;
        try {
          const { stdout: ipOut } = await execAsync(`"${adb}" shell ip route | grep src | awk '{print $9}'`, { timeout: 3000 });
          ip = ipOut.trim();
        } catch { /* ignore */ }
        
        // Try to get the adb connect port from the device identifier
        const match = lines[0].match(/^(\S+)\s+device/);
        const deviceId = match ? match[1] : null;
        
        // If it's an IP:port format, use it directly
        let endpoint = null;
        if (deviceId && deviceId.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)) {
          endpoint = deviceId;
        } else if (ip) {
          endpoint = ip + ':5555';
        }
        
        return { connected: true, endpoint: endpoint, ip: ip, deviceId: deviceId };
      }
      return { connected: false };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }
  
  async discoverDevices() {
    return new Promise((resolve) => {
      const devices = {};
      
      const addDevice = (s, type) => {
        if (!s || !s.addresses || s.addresses.length === 0) {
          return;
        }
        // Prioritize IPv4 address to prevent separate IPv4/IPv6 cards for the same TV
        const ip = s.addresses.find(addr => addr.includes('.')) || s.addresses[0];
        if (!ip) {
          return;
        }

        if (!devices[ip]) {
          devices[ip] = { ip, id: null, cast: false, remote: false, adbPairing: false, adbConnect: false };
        }
        
        let friendlyName = null;
        if (s.txt && s.txt.fn) {
          friendlyName = typeof s.txt.fn === 'string' ? s.txt.fn : s.txt.fn.toString();
        } else if (s.name) {
          // Strip the 32-character hex suffix from name if it matches Cast suffix pattern
          friendlyName = s.name.replace(/-[a-fA-F0-9]{32}$/, '').replace(/_/g, ' ');
        }

        // Set or refine the friendly name
        if (friendlyName && (!devices[ip].name || devices[ip].name.match(/[a-fA-F0-9]{32}/))) {
          devices[ip].name = friendlyName;
        }

        if (s.txt && s.txt.id) {
          devices[ip].id = s.txt.id;
        }

        if (type === 'cast') {
          devices[ip].cast = true;
        }
        if (type === 'remote') {
          devices[ip].remote = true;
        }
        if (type === 'adb-pairing') {
          devices[ip].adbPairing = true;
          devices[ip].adbPairingEndpoint = `${ip}:${s.port}`;
        }
        if (type === 'adb-connect') {
          devices[ip].adbConnect = true;
          devices[ip].adbConnectEndpoint = `${ip}:${s.port}`;
        }
      };

      const browserCast = this.bonjour.find({ type: 'googlecast' }, (s) => addDevice(s, 'cast'));
      const browserRemote = this.bonjour.find({ type: 'androidtvremote2' }, (s) => addDevice(s, 'remote'));
      const browserAdbP = this.bonjour.find({ type: 'adb-tls-pairing' }, (s) => addDevice(s, 'adb-pairing'));
      const browserAdbC = this.bonjour.find({ type: 'adb-tls-connect' }, (s) => addDevice(s, 'adb-connect'));
      
      setTimeout(() => {
        browserCast.stop();
        browserRemote.stop();
        browserAdbP.stop();
        browserAdbC.stop();
        resolve(Object.values(devices));
      }, 5000);
    });
  }
  
  async pairAdb(payload) {
    const { endpoint, code } = payload;
    try {
      const adb = await getAdbPath();
      if (!adb) {
        return { 
          success: false, 
          message: 'ADB is not installed on this system or container. You can skip ADB and continue setup.', 
        };
      }
      const { stdout, stderr } = await execAsync(`"${adb}" pair ${endpoint} ${code}`);
      if (stdout.includes('Successfully paired')) {
        return { success: true, message: stdout };
      }
      return { success: false, message: stdout || stderr };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async startRemotePairing(payload) {
    const { ip } = payload;
    if (this.currentRemote) {
      try {
        this.currentRemote.stop();
      } catch { /* ignore */ }
      this.currentRemote = null;
    }
    return new Promise((resolve) => {
      try {
        const remote = new androidtvRemote.AndroidRemote(ip, {
          pairing_port: 6467,
          remote_port: 6466,
          name: 'homebridge-google-tv',
          cert: {},
        });

        this.currentRemote = remote;

        remote.on('secret', () => {
          resolve({ success: true });
        });

        remote.on('error', (err) => {
          this.currentRemote = null;
          resolve({ success: false, message: err.toString() });
        });

        remote.start().catch((err) => {
          this.currentRemote = null;
          resolve({ success: false, message: err.toString() });
        });
      } catch (e) {
        this.currentRemote = null;
        resolve({ success: false, message: e.message });
      }
    });
  }

  async submitRemotePin(payload) {
    const { code } = payload;
    return new Promise((resolve) => {
      if (!this.currentRemote) {
        return resolve({ success: false, message: 'Session expired. Start pairing again.' });
      }

      const timeout = setTimeout(() => {
        if (this.currentRemote) {
          this.currentRemote.stop();
          this.currentRemote = null;
        }
        resolve({ success: false, message: 'Pairing request timed out. Please try again.' });
      }, 15000);

      this.currentRemote.removeAllListeners('ready');
      this.currentRemote.removeAllListeners('error');

      this.currentRemote.on('ready', () => {
        clearTimeout(timeout);
        const cert = this.currentRemote.getCertificate();
        this.currentRemote.stop();
        this.currentRemote = null;
        resolve({ success: true, cert });
      });

      this.currentRemote.on('error', (err) => {
        clearTimeout(timeout);
        if (this.currentRemote) {
          this.currentRemote.stop();
          this.currentRemote = null;
        }
        resolve({ success: false, message: err.toString() });
      });

      try {
        const sent = this.currentRemote.sendCode(code);
        if (!sent) {
          clearTimeout(timeout);
          if (this.currentRemote) {
            this.currentRemote.stop();
            this.currentRemote = null;
          }
          resolve({ success: false, message: 'Incorrect PIN code entered.' });
        }
      } catch (e) {
        clearTimeout(timeout);
        if (this.currentRemote) {
          this.currentRemote.stop();
          this.currentRemote = null;
        }
        resolve({ success: false, message: e.message });
      }
    });
  }

  async restartHomebridge() {
    setTimeout(() => {
      exec('pkill -9 -f homebridge', (err) => {
        if (err) {
          console.error('[ADBCast UI] Failed to restart Homebridge via pkill:', err);
          process.exit(0);
        }
      });
    }, 1000);
    return { success: true };
  }
}

(() => {
  return new PluginUiServer();
})();
