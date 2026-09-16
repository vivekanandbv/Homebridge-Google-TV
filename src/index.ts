import './cast/protoFix.js';
import { API } from 'homebridge';
import { PLATFORM_NAME } from './settings.js';
import { ADBCastPlatform } from './platform.js';

// Guard against unhandled rejections and exceptions terminating child bridge processes
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[ADBCast] Unhandled Promise Rejection (suppressed to keep child bridge running):', reason);
});

process.on('uncaughtException', (err: Error) => {
  console.error('[ADBCast] Uncaught Exception (suppressed to keep child bridge running):', err);
});

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, ADBCastPlatform);
};
