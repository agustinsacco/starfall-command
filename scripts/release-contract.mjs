import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const REPO = 'agustinsacco/starfall-command';
export function assertVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Error('Expected a stable semantic version');
  return value;
}
export function releaseVersion(base, count) {
  assertVersion(base);
  if (!Number.isSafeInteger(count) || count < 1) throw Error('Expected positive first-parent commit count');
  return base.split('.').slice(0, 2).join('.') + '.' + count;
}
export function expectedAssets(version, platform = null) {
  assertVersion(version);
  const prefix = `starfall-command-${version}`;
  const assets = {
    mac: ['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(ext => `${prefix}-mac-${arch}.${ext}`)),
    linux: ['x86_64', 'arm64'].map(arch => `${prefix}-linux-${arch}.AppImage`).concat(['amd64', 'arm64'].map(arch => `${prefix}-linux-${arch}.deb`)),
    win: [`${prefix}-win-x64.exe`]
  };
  if (platform && !assets[platform]) throw Error('Unsupported release platform');
  return platform ? assets[platform] : Object.values(assets).flat();
}
export function assertAssetSet(names, version, platform = null) {
  for (const name of expectedAssets(version, platform)) if (!names.includes(name)) throw Error('Missing installer: ' + name);
  const extras = names.filter(name => /\.(dmg|zip|AppImage|deb|exe)$/.test(name) && !expectedAssets(version, platform).includes(name));
  if (extras.length) throw Error('Unexpected installer(s): ' + extras.join(', '));
}
export function trustedRun(run, repository, sha) {
  return repository === REPO && run.name === 'CI' && run.event === 'push' && run.head_branch === 'main' &&
    run.head_repository?.full_name === repository && run.conclusion === 'success' && run.head_sha === sha;
}
export function skipRelease(message) {
  const trailers = execFileSync('git', ['interpret-trailers', '--parse'], { input: message, encoding: 'utf8' });
  const values = trailers.split('\n').filter(line => /^skip-release:/i.test(line));
  return /:\s*(true|yes|1)\s*$/i.test(values.at(-1) || '');
}
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyInstallers(directory, version, platform = null) {
  assertAssetSet(await readdir(directory), version, platform);
  for (const name of expectedAssets(version, platform)) {
    const file = path.join(directory, name), info = await stat(file);
    if (!info.isFile() || info.size < 1024 * 1024) throw Error('Installer is empty or implausibly small: ' + name);
  }
}
export async function writeChecksums(directory, names) {
  const lines = [];
  for (const name of [...names].sort()) {
    if (path.basename(name) !== name || /[\r\n]/.test(name)) throw Error('Unsafe checksum filename');
    lines.push(`${await sha256(path.join(directory, name))}  ${name}`);
  }
  await writeFile(path.join(directory, 'checksums.txt'), lines.join('\n') + '\n');
}
export async function metadata(cwd = process.cwd()) {
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  return { version: releaseVersion(pkg.version, Number(git(['rev-list', '--first-parent', '--count', 'HEAD']))), sha: git(['rev-parse', 'HEAD']) };
}
