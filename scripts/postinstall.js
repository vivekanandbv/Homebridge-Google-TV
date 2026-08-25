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

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
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
  const platform = process.platform;
  const url = urls[platform];
  if (!url) {
    console.log(`Unsupported platform for automatic ADB download: ${platform}. Skipping.`);
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const zipPath = path.join(binDir, 'platform-tools.zip');
  console.log(`Downloading ADB for ${platform} from ${url}...`);

  try {
    await downloadFile(url, zipPath);
    console.log('Download complete. Extracting files...');

    if (platform === 'win32') {
      await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`);
    } else {
      await execAsync(`unzip -o "${zipPath}" -d "${binDir}"`);
      // Set execute permissions
      const adbBinary = path.join(binDir, 'platform-tools', 'adb');
      if (fs.existsSync(adbBinary)) {
        fs.chmodSync(adbBinary, 0o755);
      }
    }

    // Clean up zip
    fs.unlinkSync(zipPath);
    console.log('ADB successfully installed locally in the plugin bin directory.');
  } catch (error) {
    console.error('Failed to install ADB automatically:', error.message);
    console.warn('\n================================================================');
    console.warn('WARNING: ADB (Android Debug Bridge) installation was not completed.');
    console.warn('The plugin will fall back to the system-installed adb command.');
    console.warn('If you do not have ADB installed globally, please install it manually:');
    console.warn('  - macOS (Homebrew): brew install android-platform-tools');
    console.warn('  - Debian/Ubuntu:    sudo apt-get install android-tools-adb');
    console.warn('  - Windows:          Download platform-tools from developer.android.com');
    console.warn('                      and add the folder to your system PATH.');
    console.warn('================================================================\n');
  }
}

install();
