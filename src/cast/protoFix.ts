import protobuf from 'protobufjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

try {
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

  messages.forEach((message) => {
    const type = root.lookupType(`extensions.api.cast_channel.${message}`);
    proto[message] = {
      serialize: (data: unknown) => type.encode(type.create(data as Record<string, unknown>)).finish(),
      parse: (data: Uint8Array) => type.decode(data),
    };
  });
} catch (error) {
  // If castv2 is not found or fails to pre-load, let castv2 use its default loader
  console.warn('[ADBCast] Warning: Failed to synchronously pre-load castv2 protobuf:', error);
}
