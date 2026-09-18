/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { getLocalAdbPath, installAdb, isAdbExecutable } from './ADBInstaller.js';

const execAsync = promisify(exec);

// Resolve ADB path, prioritizing verified working system ADB.
export let adbPath = 'adb';
const localAdb = getLocalAdbPath();

function resolveAdbPath(): string {
  if (existsSync('/usr/bin/adb')) {
    return '/usr/bin/adb';
  }

  if (existsSync('/usr/local/bin/adb')) {
    return '/usr/local/bin/adb';
  }

  if (existsSync('/opt/homebrew/bin/adb')) {
    return '/opt/homebrew/bin/adb';
  }

  if (existsSync(localAdb)) {
    return localAdb;
  }

  return 'adb';
}

export async function resolveWorkingAdbPath(): Promise<string> {
  const candidates = [
    '/usr/bin/adb',
    '/usr/local/bin/adb',
    '/opt/homebrew/bin/adb',
    localAdb,
    'adb',
  ];

  for (const p of candidates) {
    if (p === 'adb' || existsSync(p)) {
      if (await isAdbExecutable(p)) {
        adbPath = p;
        return p;
      }
    }
  }

  adbPath = resolveAdbPath();
  return adbPath;
}

adbPath = resolveAdbPath();

export interface ADBMediaState {
  appPackage?: string;
  playbackState: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ERROR' | 'UNKNOWN';
}

export class ADBClient extends EventEmitter {
  public ip: string;
  public port: number;
  public endpoint: string;
  public isConnected: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  public targetIdentifier: string | null = null;
  private log: (message: string, isError?: boolean) => void;
  private lastAdbWarningTime: number = 0;
  private adbInstallAttempted: boolean = false;
  private lastConnectAttemptTime: number = 0;

  constructor(
    ip: string,
    port: number = 43747,
    log?: (message: string, isError?: boolean) => void,
  ) {
    super();
    this.ip = ip;
    this.port = port;
    this.endpoint = `${ip}:${port}`;
    this.log =
      log ||
      ((msg, isErr) => (isErr ? console.error(msg) : console.log(msg)));
  }

  private async findTargetIdentifier(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`"${adbPath}" devices -l`, { timeout: 4000 });
      const lines = stdout
        .split('\n')
        .filter((l) => l.includes('device ') && !l.startsWith('List'));

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
          const { stdout: ipOut } = await execAsync(
            `"${adbPath}" -s ${id} shell ip route | grep src | awk '{print $9}'`,
            { timeout: 3000 },
          );

          if (ipOut.trim() === this.ip) {
            return id;
          }
        } catch {
          // Ignore errors while checking other connected devices.
        }
      }
    } catch (e: any) {
      this.log(`Error finding target identifier: ${e.message}`, true);
    }

    return null;
  }

  private async checkAdbWorks(): Promise<boolean> {
    return await isAdbExecutable(adbPath);
  }

  /**
   * Ensure that ADB is available.
   *
   * Priority:
   * 1. Locally bundled/downloaded ADB
   * 2. System-installed ADB
   * 3. Automatically download bundled ADB / package manager install
   */
  private async ensureAdbAvailable(): Promise<boolean> {
    try {
      // Refresh the path in case ADB was installed after module startup.
      adbPath = await resolveWorkingAdbPath();

      if (await this.checkAdbWorks()) {
        return true;
      }

      // If we already attempted an automatic installation during this
      // plugin instance, don't repeatedly download ADB.
      if (this.adbInstallAttempted) {
        return false;
      }

      this.adbInstallAttempted = true;

      this.log(
        'ADB was not found. Attempting to install or download Android Platform Tools automatically...',
      );

      const installed = await installAdb((message, isError) => {
        this.log(message, isError);
      });

      if (!installed) {
        return false;
      }

      // The installer has now placed ADB in the local plugin directory or installed via apk/apt.
      // Resolve the path again and verify the executable.
      adbPath = await resolveWorkingAdbPath();

      const adbWorks = await this.checkAdbWorks();

      if (adbWorks) {
        this.log(`ADB is ready: ${adbPath}`);
        return true;
      }

      this.log(
        'ADB was installed/downloaded but could not be executed on this architecture.',
        true,
      );

      return false;
    } catch (e: any) {
      this.log(`Error checking ADB availability: ${e.message}`, true);
      return false;
    }
  }

  private logAdbMissingWarning() {
    const now = Date.now();

    if (now - this.lastAdbWarningTime > 60000) {
      this.log(
        `ADB (Android Debug Bridge) is not available.
Automatic installation was unsuccessful.
The plugin will continue without ADB until it becomes available.`,
        true,
      );

      this.lastAdbWarningTime = now;
    }
  }

  private async configureNetworkStandby() {
    if (!this.targetIdentifier) {
      return;
    }
    try {
      this.log('Silently configuring TV to keep Wi-Fi and Cast connection active during standby...');
      await execAsync(`"${adbPath}" -s ${this.targetIdentifier} shell settings put global wifi_sleep_policy 2`, { timeout: 4000 });
      await execAsync(`"${adbPath}" -s ${this.targetIdentifier} shell settings put global stay_on_while_plugged_in 3`, { timeout: 4000 });
    } catch (e: any) {
      this.log(`Failed to configure network standby: ${e.message}`, true);
    }
  }

  async connect(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastConnectAttemptTime < 30000) {
      return false; // Cooldown for 30 seconds to prevent ADB daemon lockup
    }
    this.lastConnectAttemptTime = now;

    try {
      const adbAvailable = await this.ensureAdbAvailable();

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
        await this.configureNetworkStandby();
        this.emit('connected');
        return true;
      }

      this.log(`Falling back to manual adb connect ${this.endpoint}`);

      const { stdout } = await execAsync(
        `"${adbPath}" connect ${this.endpoint}`,
        { timeout: 8000 },
      );

      if (
        stdout.includes('connected to') ||
        stdout.includes('already connected')
      ) {
        this.targetIdentifier = this.endpoint;
        this.isConnected = true;
        await this.configureNetworkStandby();
        this.emit('connected');
        return true;
      }

      if (
        stdout.includes('failed to authenticate') ||
        stdout.includes('Connection refused')
      ) {
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
    const adbAvailable = await this.ensureAdbAvailable();

    if (!adbAvailable) {
      this.logAdbMissingWarning();
      return false;
    }

    try {
      const { stdout } = await execAsync(
        `"${adbPath}" pair ${pairingEndpoint} ${code}`,
        { timeout: 10000 },
      );

      if (stdout.includes('Successfully paired')) {
        return true;
      }
    } catch (e: any) {
      this.log(`Pair error: ${e.message}`, true);
    }

    return false;
  }

  async getMediaState(): Promise<ADBMediaState> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      if (!this.isConnected) {
        return { playbackState: 'UNKNOWN' };
      }

      const target = this.targetIdentifier || this.endpoint;

      const { stdout } = await execAsync(
        `"${adbPath}" -s ${target} shell dumpsys media_session`,
        { timeout: 5000 },
      );

      const lines = stdout.split('\n');

      const sessions: Array<{
        pkg?: string;
        active: boolean;
        state: string;
      }> = [];

      let currentSession: {
        pkg?: string;
        active: boolean;
        state: string;
      } | null = null;

      for (const line of lines) {
        const sessionStartMatch = line.match(/^\s{4}([^\s].*)/);
        const propertyMatch = line.match(/^\s{6}([^\s].*)/);

        if (sessionStartMatch) {
          if (currentSession) {
            sessions.push(currentSession);
          }

          currentSession = {
            active: false,
            state: 'UNKNOWN',
          };
        } else if (propertyMatch && currentSession) {
          const prop = propertyMatch[1];

          if (prop.startsWith('package=')) {
            currentSession.pkg = prop.substring(8).trim();
          } else if (prop.startsWith('active=')) {
            currentSession.active =
              prop.substring(7).trim() === 'true';
          } else if (prop.startsWith('state=PlaybackState')) {
            currentSession.state = prop;
          }
        }
      }

      if (currentSession) {
        sessions.push(currentSession);
      }

      // Find active session.
      const activeSession = sessions.find(
        (s) => s.active && s.state.includes('state='),
      );

      if (activeSession) {
        const stateStr = activeSession.state;

        let playbackState:
          | 'PLAYING'
          | 'PAUSED'
          | 'BUFFERING'
          | 'ERROR'
          | 'UNKNOWN' = 'UNKNOWN';

        if (
          stateStr.includes('state=PLAYING') ||
          stateStr.includes('state=3')
        ) {
          playbackState = 'PLAYING';
        } else if (
          stateStr.includes('state=PAUSED') ||
          stateStr.includes('state=2') ||
          stateStr.includes('state=STOPPED') ||
          stateStr.includes('state=1')
        ) {
          playbackState = 'PAUSED';
        } else if (
          stateStr.includes('state=BUFFERING') ||
          stateStr.includes('state=6') ||
          stateStr.includes('state=CONNECTING') ||
          stateStr.includes('state=8')
        ) {
          playbackState = 'BUFFERING';
        }

        // Silent background state parsing

        return {
          appPackage: activeSession.pkg,
          playbackState,
        };
      }

      // Silent background state parsing

      return {
        playbackState: 'UNKNOWN',
      };
    } catch (e: any) {
      if (
        e.message?.includes('not found') ||
        e.message?.includes('unauthorized')
      ) {
        this.isConnected = false;
      }

      return {
        playbackState: 'UNKNOWN',
      };
    }
  }

  async sendKey(keyCode: number): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      const target = this.targetIdentifier || this.endpoint;
      await execAsync(`"${adbPath}" -s ${target} shell input keyevent ${keyCode}`, { timeout: 4000 });
      return true;
    } catch (e: any) {
      this.log(`sendKey error (${keyCode}): ${e.message}`, true);
      return false;
    }
  }

  async powerOn(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      const target = this.targetIdentifier || this.endpoint;
      await execAsync(`"${adbPath}" -s ${target} shell input keyevent 224`, { timeout: 4000 });
      return true;
    } catch (e: any) {
      this.log(`powerOn error: ${e.message}`, true);
      return false;
    }
  }

  async powerOff(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      const target = this.targetIdentifier || this.endpoint;
      await execAsync(`"${adbPath}" -s ${target} shell input keyevent 223`, { timeout: 4000 });
      return true;
    } catch (e: any) {
      this.log(`powerOff error: ${e.message}`, true);
      return false;
    }
  }

  startPolling(intervalMs: number = 5000) {
    this.stopPolling();

    this.pollingInterval = setInterval(async () => {
      try {
        const state = await this.getMediaState();
        this.emit('media_state', state);
      } catch (err: any) {
        this.log(`Error in ADB media polling: ${err?.message || err}`, true);
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
