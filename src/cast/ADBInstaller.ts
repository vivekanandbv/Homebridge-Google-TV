import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const urls: Record<string, string> = {
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
};

export function getLocalAdbPath(): string {
  return path.join(
    __dirname,
    '..',
    '..',
    'bin',
    'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlink(dest, () => {});

        if (!response.headers.location) {
          reject(new Error('Download redirect did not provide a location.'));
          return;
        }

        downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', (error) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(error);
    });
  });
}

export async function installAdb(
  log: (message: string, isError?: boolean) => void = (message, isError) => {
    if (isError) {
      console.error(message);
    } else {
      console.log(message);
    }
  },
): Promise<boolean> {
  const platform = process.platform;
  const url = urls[platform];

  if (!url) {
    log(`Unsupported platform for automatic ADB download: ${platform}.`, true);
    return false;
  }

  const adbPath = getLocalAdbPath();
  const binDir = path.dirname(path.dirname(adbPath));

  if (fs.existsSync(adbPath)) {
    return true;
  }

  fs.mkdirSync(binDir, { recursive: true });

  const zipPath = path.join(binDir, 'platform-tools.zip');

  try {
    log(`Downloading ADB for ${platform}...`);

    await downloadFile(url, zipPath);

    log('Download complete. Extracting files...');

    if (platform === 'win32') {
      await execAsync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`,
      );
    } else {
      await execAsync(`unzip -o "${zipPath}" -d "${binDir}"`);
    }

    if (fs.existsSync(adbPath) && platform !== 'win32') {
      fs.chmodSync(adbPath, 0o755);
    }

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    if (!fs.existsSync(adbPath)) {
      log('ADB download completed, but the adb executable was not found.', true);
      return false;
    }

    log('ADB successfully installed locally.');
    return true;
  } catch (error: unknown) {
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        // Ignore cleanup errors.
      }
    }

    log(`Failed to install ADB automatically: ${error instanceof Error ? error.message : String(error)}`, true);
    return false;
  }
}
