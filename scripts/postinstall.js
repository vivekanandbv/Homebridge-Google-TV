/* global process, console */
import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const urls = {
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
};

async function isAdbWorking(cmd = 'adb') {
  try {
    await execAsync(`${cmd} --version`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function tryPackageManagers() {
  if (process.platform !== 'linux') {
    return false;
  }

  // 1. Check for Alpine Linux (very common for Synology / Homebridge Docker containers)
  if (fs.existsSync('/etc/alpine-release')) {
    try {
      console.log('Alpine Linux container detected. Attempting to install android-tools via apk...');
      await execAsync('apk add --no-cache android-tools', { timeout: 30000 });
      if (await isAdbWorking('adb')) {
        console.log('ADB successfully installed via apk.');
        return true;
      }
    } catch (e) {
      console.log('apk install attempted:', e.message);
    }
  }

  // 2. Check for Debian / Ubuntu
  if (fs.existsSync('/etc/debian_version')) {
    try {
      console.log('Debian/Ubuntu container detected. Attempting to install adb via apt-get...');
      await execAsync(
        'apt-get update -qq && (apt-get install -y -qq adb || apt-get install -y -qq android-tools-adb)',
        { timeout: 60000 },
      );
      if (await isAdbWorking('adb')) {
        console.log('ADB successfully installed via apt-get.');
        return true;
      }
    } catch (e) {
      console.log('apt-get install attempted:', e.message);
    }
  }

  return false;
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function install() {
  try {
    // Check if system ADB is already working
    const candidatePaths = ['adb', '/opt/homebrew/bin/adb', '/usr/local/bin/adb', '/usr/bin/adb'];
    for (const p of candidatePaths) {
      if (await isAdbWorking(p)) {
        console.log('Working ADB detected on system. Skipping download.');
        return;
      }
    }

    // Try container package managers on Linux first (e.g. Synology Docker / Alpine)
    if (await tryPackageManagers()) {
      return;
    }

    const platform = process.platform;
    const url = urls[platform];
    if (!url) {
      console.log(`Unsupported platform for automatic ADB download: ${platform}. Skipping.`);
      return;
    }

    // On Linux ARM, Google platform-tools zip is x86_64 only
    if (platform === 'linux' && process.arch !== 'x64') {
      console.log(`Linux ${process.arch} architecture detected. Google platform-tools binaries are x86_64 only.`);
      console.log('Please ensure android-tools is installed on the host system.');
      return;
    }

    const binDir = path.join(__dirname, '..', 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const zipPath = path.join(binDir, 'platform-tools.zip');
    console.log(`Downloading ADB for ${platform} from ${url}...`);

    await downloadFile(url, zipPath);
    console.log('Download complete. Extracting files...');

    if (platform === 'win32') {
      await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`);
    } else {
      try {
        await execAsync(`unzip -o "${zipPath}" -d "${binDir}"`);
      } catch {
        // If unzip is missing on Linux, fallback
        console.log('unzip utility not available; please install unzip or android-tools.');
      }
      const adbBinary = path.join(binDir, 'platform-tools', 'adb');
      if (fs.existsSync(adbBinary)) {
        fs.chmodSync(adbBinary, 0o755);
      }
    }

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    const localAdb = path.join(binDir, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb');
    if (await isAdbWorking(localAdb)) {
      console.log('ADB successfully installed locally in the plugin bin directory.');
    }
  } catch (error) {
    console.log('Automatic ADB postinstall step finished with note:', error.message);
  }
}

install();
