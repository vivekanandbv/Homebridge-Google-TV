import { CastClient } from './CastClient.js';
import { AndroidTVClient } from './AndroidTVClient.js';
import { ADBClient, ADBMediaState } from './ADBClient.js';
import { EventEmitter } from 'events';

export type UnifiedPlaybackState = 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ERROR' | 'UNKNOWN';

export interface TVCapabilities {
    power: 'AndroidTVRemote' | 'UNSUPPORTED';
    volume: 'AndroidTVRemote' | 'Cast' | 'UNSUPPORTED';
    playback: 'Cast' | 'ADB' | 'UNKNOWN';
}

export class MediaStateManager extends EventEmitter {
  private cast: CastClient;
  private remote: AndroidTVClient;
  private adb?: ADBClient;
    
  private castState: UnifiedPlaybackState = 'UNKNOWN';
  private adbState: ADBMediaState = { playbackState: 'UNKNOWN' };
    
  constructor(cast: CastClient, remote: AndroidTVClient, adb?: ADBClient) {
    super();
    this.cast = cast;
    this.remote = remote;
    this.adb = adb;
        
    // Listen to Cast events (assuming CastClient emits these)
    // this.cast.on('media_status', (status) => {
    //     this.castState = this.mapCastState(status);
    //     this.emit('state_changed');
    // });
        
    if (this.adb) {
      this.adb.on('media_state', (state: ADBMediaState) => {
        this.adbState = state;
        this.emit('state_changed');
      });
            
      if (this.remote.isPowerOn) {
        this.adb.startPolling(3000);
      }

      this.remote.on('powered', (powered: boolean) => {
        if (this.adb) {
          if (powered) {
            this.adb.startPolling(3000);
          } else {
            this.adb.stopPolling();
            this.adbState = { playbackState: 'UNKNOWN' };
            this.emit('state_changed');
          }
        }
      });
    }
  }
    
  public getResolvedPlaybackState(): { state: UnifiedPlaybackState, source: 'Cast' | 'ADB' | 'UNKNOWN' } {
    // 1. Cast has priority IF it is actively playing a cast session
    if (this.castState === 'PLAYING' || this.castState === 'BUFFERING' || this.castState === 'PAUSED') {
      // Note: A true robust implementation needs to verify there is an active session ID
      return { state: this.castState, source: 'Cast' };
    }
        
    // 2. ADB MediaSession for native apps
    if (this.adb && this.adbState.playbackState !== 'UNKNOWN') {
      return { state: this.adbState.playbackState, source: 'ADB' };
    }
        
    // 3. Fallback
    return { state: 'UNKNOWN', source: 'UNKNOWN' };
  }
    
  public async setPower(on: boolean) {
    if (on) {
      await this.remote.powerOn();
    } else {
      await this.remote.powerOff();
    }
  }
    
  public async setPlayPause(play: boolean) {
    const resolution = this.getResolvedPlaybackState();
    if (resolution.source === 'Cast') {
      // Send cast command
      // await this.cast.play() / pause()
    } else {
      // Use Android TV remote media keys
      if (play) {
        await this.remote.sendKey(126); // KEYCODE_MEDIA_PLAY
      } else {
        await this.remote.sendKey(127); // KEYCODE_MEDIA_PAUSE
      }
    }
  }
}
