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
}

applyProtoFix();
