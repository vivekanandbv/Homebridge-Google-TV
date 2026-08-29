/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve adb path, prioritizing locally downloaded adb
export let adbPath = 'adb';
const localAdb = join(__dirname, '..', '..', 'bin', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');

if (existsSync(localAdb)) {
  adbPath = localAdb;
} else if (existsSync('/opt/homebrew/bin/adb')) {
  adbPath = '/opt/homebrew/bin/adb';
} else if (existsSync('/usr/local/bin/adb')) {
  adbPath = '/usr/local/bin/adb';
}

export interface ADBMediaState {
    appPackage?: string;
    playbackState: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ERROR' | 'UNKNOWN';
}

export class ADBClient extends EventEmitter {
  public ip: string;
  public port: number;
  private endpoint: string;
  public isConnected: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  public targetIdentifier: string | null = null;
  private log: (message: string, isError?: boolean) => void;
  private lastAdbWarningTime: number = 0;
    
  constructor(ip: string, port: number = 43747, log?: (message: string, isError?: boolean) => void) {
    super();
    this.ip = ip;
    this.port = port;
    this.endpoint = `${ip}:${port}`;
    this.log = log || ((msg, isErr) => isErr ? console.error(msg) : console.log(msg));
  }
    
  private async findTargetIdentifier(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`${adbPath} devices -l`);
      const lines = stdout.split('\n').filter(l => l.includes('device ') && !l.startsWith('List'));
            
      for (const line of lines) {
        const match = line.match(/^(\S+)\s+device/);
        if (!match) {
          continue;
        }
        const id = match[1];
                
        if (id.startsWith(this.ip + ':')) {
          return id;
        }
                
        try {
          const { stdout: ipOut } = await execAsync(`${adbPath} -s ${id} shell ip route | grep src | awk '{print $9}'`);
          if (ipOut.trim() === this.ip) {
            return id;
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e: any) {
      this.log(`Error finding target identifier: ${e.message}`, true);
    }
    return null;
  }

  private async checkAdbWorks(): Promise<boolean> {
    try {
      await execAsync(`${adbPath} version`);
      return true;
    } catch {
      return false;
    }
  }

  private logAdbMissingWarning() {
    const now = Date.now();
    if (now - this.lastAdbWarningTime > 60000) {
      this.log(`ADB (Android Debug Bridge) is not installed or found on the system.
Please install ADB manually to enable Android TV/Google TV control:
- macOS (Homebrew): brew install android-platform-tools
- Debian/Ubuntu:    sudo apt-get install android-tools-adb
- Windows:          Download platform-tools from developer.android.com and add to PATH.`, true);
      this.lastAdbWarningTime = now;
    }
  }
    
  async connect(): Promise<boolean> {
    const adbAvailable = await this.checkAdbWorks();
    if (!adbAvailable) {
      this.isConnected = false;
      this.logAdbMissingWarning();
      return false;
    }

    this.log(`Connecting to ${this.ip}...`);
    this.targetIdentifier = await this.findTargetIdentifier();
    if (this.targetIdentifier) {
      this.log(`Found target identifier: ${this.targetIdentifier}`);
      this.isConnected = true;
      this.emit('connected');
      return true;
    }

    try {
      this.log(`Falling back to manual adb connect ${this.endpoint}`);
      const { stdout } = await execAsync(`${adbPath} connect ${this.endpoint}`);
      if (stdout.includes('connected to') || stdout.includes('already connected')) {
        this.targetIdentifier = this.endpoint;
        this.isConnected = true;
        this.emit('connected');
        return true;
      }
      if (stdout.includes('failed to authenticate') || stdout.includes('Connection refused')) {
        this.isConnected = false;
        this.emit('unauthorized');
        return false;
      }
    } catch (e: any) {
      this.isConnected = false;
      this.log(`Connect error: ${e.message}`, true);
    }
    return false;
  }
    
  async pair(pairingEndpoint: string, code: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`${adbPath} pair ${pairingEndpoint} ${code}`);
      if (stdout.includes('Successfully paired')) {
        return true;
      }
    } catch (e: any) {
      this.log(`Pair error: ${e.message}`, true);
    }
    return false;
  }
    
  async getMediaState(): Promise<ADBMediaState> {
    if (!this.isConnected) {
      await this.connect();
    }
    if (!this.isConnected) {
      return { playbackState: 'UNKNOWN' };
    }
        
    try {
      const target = this.targetIdentifier || this.endpoint;
      const { stdout } = await execAsync(`${adbPath} -s ${target} shell dumpsys media_session`);
            
      const lines = stdout.split('\n');
      const sessions: Array<{ pkg?: string; active: boolean; state: string }> = [];
      let currentSession: { pkg?: string; active: boolean; state: string } | null = null;
            
      for (const line of lines) {
        const sessionStartMatch = line.match(/^\s{4}([^\s].*)/);
        const propertyMatch = line.match(/^\s{6}([^\s].*)/);
                
        if (sessionStartMatch) {
          if (currentSession) {
            sessions.push(currentSession);
          }
          currentSession = { active: false, state: 'UNKNOWN' };
        } else if (propertyMatch && currentSession) {
          const prop = propertyMatch[1];
          if (prop.startsWith('package=')) {
            currentSession.pkg = prop.substring(8).trim();
          } else if (prop.startsWith('active=')) {
            currentSession.active = prop.substring(7).trim() === 'true';
          } else if (prop.startsWith('state=PlaybackState')) {
            currentSession.state = prop;
          }
        }
      }
      if (currentSession) {
        sessions.push(currentSession);
      }
            
      // Find active session
      const activeSession = sessions.find(s => s.active && s.state.includes('state='));
      if (activeSession) {
        const stateStr = activeSession.state;
        let playbackState: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ERROR' | 'UNKNOWN' = 'UNKNOWN';
                
        if (stateStr.includes('state=PLAYING') || stateStr.includes('state=3')) {
          playbackState = 'PLAYING';
        } else if (stateStr.includes('state=PAUSED') || stateStr.includes('state=2') ||
                           stateStr.includes('state=STOPPED') || stateStr.includes('state=1')) {
          playbackState = 'PAUSED';
        } else if (stateStr.includes('state=BUFFERING') || stateStr.includes('state=6') ||
                           stateStr.includes('state=CONNECTING') || stateStr.includes('state=8')) {
          playbackState = 'BUFFERING';
        }
                
        this.log(`getMediaState active session package: ${activeSession.pkg}, state: ${playbackState}`);
                
        return {
          appPackage: activeSession.pkg,
          playbackState,
        };
      }
            
      this.log('getMediaState no active session found');
      return { playbackState: 'UNKNOWN' };
    } catch (e: any) {
      if (e.message.includes('not found') || e.message.includes('unauthorized')) {
        this.isConnected = false;
      }
      return { playbackState: 'UNKNOWN' };
    }
  }

  startPolling(intervalMs: number = 5000) {
    this.stopPolling();
    this.pollingInterval = setInterval(async () => {
      const state = await this.getMediaState();
      this.emit('media_state', state);
    }, intervalMs);
  }
    
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
