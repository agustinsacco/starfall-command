import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
if (process.platform !== 'darwin') throw Error('This local .app packager requires macOS. npm start also works on other Electron-supported desktops.');
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const executable = require('electron');
const runtime = path.resolve(executable, '../../..');
if (!runtime.endsWith('Electron.app')) throw Error('Unexpected Electron runtime layout');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist'), destination = path.join(dist, 'Starfall Command.app');
await fs.mkdir(dist, { recursive: true });
try {
  const previous = JSON.parse(await fs.readFile(path.join(destination, 'Contents/Resources/app/package.json'), 'utf8'));
  if (previous.name !== pkg.name) throw Error('Refusing to replace an unrelated application');
} catch (error) { if (error.code !== 'ENOENT') throw error; if (await fs.stat(destination).then(() => true, () => false)) throw Error('Destination exists but is not a known Starfall build', { cause: error }); }
const staging = path.join(dist, '.starfall-build-' + randomUUID()), candidate = path.join(staging, 'Starfall Command.app'), backup = path.join(staging, 'previous.app');
await fs.mkdir(staging);
const run = (bin, args) => execFileSync(bin, args, { stdio: 'pipe', timeout: 120000 });
try {
  await fs.cp(runtime, candidate, { recursive: true, verbatimSymlinks: true });
  const resources = path.join(candidate, 'Contents/Resources'), bundled = path.join(resources, 'app');
  await fs.mkdir(bundled);
  for (const item of ['index.html', 'src', 'electron', 'assets', 'README.md']) await fs.cp(path.join(root, item), path.join(bundled, item), { recursive: true });
  await fs.writeFile(path.join(bundled, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, description: pkg.description }, null, 2));
  await fs.rm(path.join(resources, 'default_app.asar'));
  const plist = path.join(candidate, 'Contents/Info.plist');
  function set(file, key, value) {
    try { run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, file]); }
    catch { run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, file]); }
  }
  set(plist, 'CFBundleDisplayName', 'Starfall Command'); set(plist, 'CFBundleName', 'Starfall Command'); set(plist, 'CFBundleIdentifier', 'com.starfall.command');
  set(plist, 'CFBundleShortVersionString', pkg.version); set(plist, 'CFBundleVersion', pkg.version);
  const frameworks = path.join(candidate, 'Contents/Frameworks');
  for (const entry of await fs.readdir(frameworks)) if (entry.startsWith('Electron Helper') && entry.endsWith('.app')) {
    const helper = path.join(frameworks, entry, 'Contents/Info.plist'), suffix = entry.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    set(helper, 'CFBundleDisplayName', entry.replace('Electron', 'Starfall')); set(helper, 'CFBundleName', entry.replace('Electron', 'Starfall').replace('.app', '')); set(helper, 'CFBundleIdentifier', 'com.starfall.command.' + suffix);
  }
  const icon = path.join(root, 'assets/generated/app-icon.png'), iconset = path.join(staging, 'Starfall.iconset');
  await fs.access(icon); await fs.mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const n = String(size * scale), filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    run('/usr/bin/sips', ['-z', n, n, icon, '--out', path.join(iconset, filename)]);
  }
  run('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(resources, 'starfall.icns'), iconset]); set(plist, 'CFBundleIconFile', 'starfall.icns');
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate]);
  let hadPrevious = false;
  try { await fs.rename(destination, backup); hadPrevious = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.rename(candidate, destination); }
  catch (error) { if (hadPrevious) await fs.rename(backup, destination); throw error; }
  console.log('Created ' + destination);
  console.log('Local ad-hoc signature verified. This is not a notarized public release.');
} finally { await fs.rm(staging, { recursive: true, force: true }); }
