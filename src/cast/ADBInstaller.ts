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

export async function isAdbExecutable(cmdPath: string): Promise<boolean> {
  try {
    await execAsync(`"${cmdPath}" version`, { timeout: 3000 });
    return true;
  } catch {
    try {
      await execAsync(`"${cmdPath}" --version`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

export async function tryContainerPackageInstall(log: (msg: string, isError?: boolean) => void): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }

  // Check Alpine Linux (Docker container standard on Synology DSM)
  if (fs.existsSync('/etc/alpine-release')) {
    try {
      log('Detected Alpine Linux container. Installing android-tools via apk...');
      try {
        await execAsync('sudo -n apk add --no-cache android-tools', { timeout: 30000 });
      } catch {
        await execAsync('apk add --no-cache android-tools', { timeout: 30000 });
      }
      if ((await isAdbExecutable('adb')) || (await isAdbExecutable('/usr/bin/adb'))) {
        log('Successfully installed android-tools (ADB) via apk.');
        return true;
      }
    } catch (e: unknown) {
      log(`apk install attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Check Debian / Ubuntu
  if (fs.existsSync('/etc/debian_version')) {
    try {
      log('Detected Debian/Ubuntu container. Installing adb via apt-get...');
      try {
        await execAsync(
          'sudo -n apt-get update -qq && (sudo -n apt-get install -y -qq adb || sudo -n apt-get install -y -qq android-tools-adb)',
          { timeout: 60000 },
        );
      } catch {
        await execAsync(
          'apt-get update -qq && (apt-get install -y -qq adb || apt-get install -y -qq android-tools-adb)',
          { timeout: 60000 },
        );
      }
      if ((await isAdbExecutable('adb')) || (await isAdbExecutable('/usr/bin/adb'))) {
        log('Successfully installed adb via apt-get.');
        return true;
      }
    } catch (e: unknown) {
      log(`apt-get install attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return false;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let file: fs.WriteStream;
    try {
      file = fs.createWriteStream(dest);
    } catch (err) {
      return reject(err);
    }

    file.on('error', (err) => {
      try {
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
      } catch { /* ignore */ }
      reject(err);
    });

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.close();
          try {
            if (fs.existsSync(dest)) {
              fs.unlinkSync(dest);
            }
          } catch { /* ignore */ }

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
          try {
            if (fs.existsSync(dest)) {
              fs.unlinkSync(dest);
            }
          } catch { /* ignore */ }
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => resolve());
        });
      })
      .on('error', (error) => {
        file.close();
        try {
          if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
          }
        } catch { /* ignore */ }
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
  // 1. Try container package manager first on Linux
  if (await tryContainerPackageInstall(log)) {
    return true;
  }

  const platform = process.platform;
  const url = urls[platform];

  if (!url) {
    log(`Unsupported platform for automatic ADB download: ${platform}.`, true);
    return false;
  }

  if (platform === 'linux' && process.arch !== 'x64') {
    log(`Linux ${process.arch} architecture detected. Google platform-tools binaries are x86_64 only.`, true);
    return false;
  }

  const adbPath = getLocalAdbPath();
  const binDir = path.dirname(path.dirname(adbPath));

  if (fs.existsSync(adbPath) && (await isAdbExecutable(adbPath))) {
    return true;
  }

  const zipPath = path.join(binDir, 'platform-tools.zip');

  try {
    fs.mkdirSync(binDir, { recursive: true });

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
      try {
        fs.chmodSync(adbPath, 0o755);
      } catch { /* ignore chmod error if non-root */ }
    }

    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch { /* ignore */ }
    }

    if (!fs.existsSync(adbPath) || !(await isAdbExecutable(adbPath))) {
      log('ADB download completed, but the binary is not executable on this architecture/OS.', true);
      return false;
    }

    log('ADB successfully installed locally.');
    return true;
  } catch (error: unknown) {
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch { /* ignore */ }
    }

    log(`Failed to install ADB automatically: ${error instanceof Error ? error.message : String(error)}`, true);
    return false;
  }
}
