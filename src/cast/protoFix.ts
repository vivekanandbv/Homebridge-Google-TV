import { createRequire } from 'module';

export function applyProtoFix(): void {
  try {
    const require = createRequire(import.meta.url);
    const protobuf = require('protobufjs');
    const protoPath = require.resolve('castv2/lib/cast_channel.proto');
    const root = protobuf.loadSync(protoPath);
    const proto = require('castv2/lib/proto') as Record<string, {
      serialize: (data: unknown) => Uint8Array;
      parse: (data: Uint8Array) => unknown;
    }>;

    const messages = [
      'CastMessage',
      'AuthChallenge',
      'AuthResponse',
      'AuthError',
      'DeviceAuthMessage',
    ];

    messages.forEach((message: string) => {
      const type = root.lookupType(`extensions.api.cast_channel.${message}`);
      proto[message] = {
        serialize: (data: unknown) => type.encode(type.create(data as Record<string, unknown>)).finish(),
        parse: (data: Uint8Array) => type.decode(data),
      };
    });
  } catch (error) {
    // If proto pre-load fails, log safely and let castv2 default loader run
    console.warn('[ADBCast] Warning: Synchronous protobuf pre-loading skipped:', error);
  }

  // Patch RemoteManager to prevent unhandled EventEmitter error crashes
  try {
    const require = createRequire(import.meta.url);
    const rmModule = require('androidtv-remote/dist/remote/RemoteManager.js');
    if (rmModule && rmModule.RemoteManager) {
      const origEmit = rmModule.RemoteManager.prototype.emit;
      rmModule.RemoteManager.prototype.emit = function (event: string, ...args: unknown[]) {
        if (event === 'error' && this.listenerCount('error') === 0) {
          // Suppress unhandled error event to prevent Node unhandled exception
          return false;
        }
        return origEmit.apply(this, [event, ...args]);
      };
    }
  } catch (err) {
    console.warn('[ADBCast] Warning: RemoteManager error patch skipped:', err);
  }
}

applyProtoFix();
