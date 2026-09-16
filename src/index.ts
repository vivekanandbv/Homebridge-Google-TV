import './cast/protoFix.js';
import { API } from 'homebridge';
import { PLATFORM_NAME } from './settings.js';
import { ADBCastPlatform } from './platform.js';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, ADBCastPlatform);
};
