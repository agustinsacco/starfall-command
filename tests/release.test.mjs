import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  REPO,
  releaseVersion,
  assertVersion,
  expectedAssets,
  assertAssetSet,
  trustedRun,
  skipRelease,
  sha256,
  writeChecksums,
} from '../scripts/release-contract.mjs';

const root = new URL('../', import.meta.url);
test('release versions are deterministic and stable semver', () => {
  assert.equal(releaseVersion('2.0.0', 2), '2.0.2');
  assert.equal(releaseVersion('2.1.0', 54), '2.1.54');
  for (const bad of ['2.0.0-beta', '2.0', '../../escape', '02.0.0', '2.0.0;exit'])
    assert.throws(() => assertVersion(bad));
  for (const bad of [0, -1, 1.5, NaN]) assert.throws(() => releaseVersion('2.0.0', bad));
});
test('only green main pushes from this repository and exact SHA are releasable', () => {
  const sha = 'a'.repeat(40),
    run = {
      name: 'CI',
      event: 'push',
      conclusion: 'success',
      head_branch: 'main',
      head_repository: { full_name: REPO },
      head_sha: sha,
    };
  assert.equal(trustedRun(run, REPO, sha), true);
  for (const patch of [
    { name: 'Other workflow' },
    { event: 'pull_request' },
    { event: 'workflow_dispatch' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'attacker/starfall-command' } },
    { head_sha: 'b'.repeat(40) },
  ])
    assert.equal(trustedRun({ ...run, ...patch }, REPO, sha), false);
  assert.equal(trustedRun(run, 'someone/else', sha), false);
});
test('skip-release is a git trailer, not a phrase that can suppress its own documentation', () => {
  assert.equal(skipRelease('Document Skip-Release: true\n\nThis explains skipping a release.\n'), false);
  assert.equal(
    skipRelease('Document trailers\n\nExample:\n    Skip-Release: true\n\nUse only for deliberate skips.\n'),
    false,
  );
  assert.equal(skipRelease('Docs only\n\nSkip-Release: true\n'), true);
  assert.equal(skipRelease('Docs only\n\nSkip-Release: yes\n'), true);
  assert.equal(skipRelease('Ship\n\nSkip-Release: false\n'), false);
});
test('release requires all nine installers, and catches wrong architecture names and stale versions', () => {
  const names = expectedAssets('2.0.2');
  assert.equal(names.length, 9);
  assertAssetSet(names, '2.0.2');
  for (const missing of names)
    assert.throws(
      () =>
        assertAssetSet(
          names.filter((n) => n !== missing),
          '2.0.2',
        ),
      /Missing installer/,
    );
  assert.throws(() => assertAssetSet([...names, 'starfall-command-2.0.1-mac-arm64.dmg'], '2.0.2'), /Unexpected/);
  assert.ok(names.includes('starfall-command-2.0.2-linux-x86_64.AppImage'));
  assert.ok(names.includes('starfall-command-2.0.2-linux-amd64.deb'));
});
test('package identity and save-preserving installer configuration are stable', async () => {
  const config = JSON.parse(await fs.readFile(new URL('electron-builder.json', root), 'utf8'));
  assert.equal(config.appId, 'com.starfall.command');
  assert.equal(config.productName, 'Starfall Command');
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.asar, true);
  assert.deepEqual(config.files, ['index.html', 'src/**', 'electron/**', 'assets/**', 'README.md', 'package.json']);
  assert.equal(config.publish.owner + '/' + config.publish.repo, REPO);
  assert.equal(config.mac.artifactName, 'starfall-command-${version}-mac-${arch}.${ext}');
  assert.equal(config.linux.artifactName, 'starfall-command-${version}-linux-${arch}.${ext}');
});
test('checksums cover exact bytes and reject path escapes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-checksums-'));
  try {
    await fs.writeFile(path.join(dir, 'one.zip'), 'fixture bytes');
    await writeChecksums(dir, ['one.zip']);
    assert.equal(
      await fs.readFile(path.join(dir, 'checksums.txt'), 'utf8'),
      (await sha256(path.join(dir, 'one.zip'))) + '  one.zip\n',
    );
    await assert.rejects(writeChecksums(dir, ['../escape']), /Unsafe/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test(
  'installer selects real electron-builder asset names without network access',
  { skip: process.platform === 'win32' },
  () => {
    for (const [platform, arch, expected] of [
      ['Darwin', 'arm64', 'mac-arm64.dmg'],
      ['Darwin', 'x86_64', 'mac-x64.dmg'],
      ['Linux', 'amd64', 'linux-x86_64.AppImage'],
      ['Linux', 'aarch64', 'linux-arm64.AppImage'],
    ]) {
      const selected = execFileSync('sh', ['scripts/install.sh', '--print-asset', platform, arch, '2.0.2'], {
        encoding: 'utf8',
      }).trim();
      assert.equal(selected, 'starfall-command-2.0.2-' + expected);
      assert.ok(expectedAssets('2.0.2').includes(selected));
    }
    assert.notEqual(spawnSync('sh', ['scripts/install.sh', '--print-asset', 'Linux', 'mips', '2.0.2']).status, 0);
  },
);

test(
  'installer fresh install/update preserves saves; corrupt or missing checksums leave the old app intact',
  { skip: process.platform === 'win32' },
  async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-install-test-'));
    try {
      const bin = path.join(temp, 'tools'),
        source = path.join(temp, 'source'),
        prefix = path.join(temp, 'home', 'local games');
      await fs.mkdir(bin);
      await fs.mkdir(source);
      // These are fixture payloads, never executed or published. Only curl/uname are mocked.
      await fs.writeFile(
        path.join(bin, 'uname'),
        '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac\n',
        { mode: 0o755 },
      );
      await fs.writeFile(
        path.join(bin, 'curl'),
        `#!${process.execPath}\nconst fs=require('fs'),path=require('path'),args=process.argv.slice(2);const url=args.find(a=>a.startsWith('https://')),out=args[args.indexOf('-o')+1];try{fs.copyFileSync(path.join(process.env.FIXTURE_SOURCE,path.basename(new URL(url).pathname)),out);}catch{process.exit(22);}\n`,
        { mode: 0o755 },
      );
      const env = {
        ...process.env,
        HOME: path.join(temp, 'home'),
        XDG_CONFIG_HOME: path.join(temp, 'home/.config'),
        PATH: bin + path.delimiter + process.env.PATH,
        STARFALL_PREFIX: prefix,
        STARFALL_VERSION: 'v2.0.2',
        FIXTURE_SOURCE: source,
      };
      const asset = 'starfall-command-2.0.2-linux-x86_64.AppImage';
      await fs.writeFile(path.join(source, asset), 'first fixture game');
      await fs.writeFile(path.join(source, 'icon.png'), 'fixture icon');
      await writeChecksums(source, [asset, 'icon.png']);
      const install = () => spawnSync('sh', ['scripts/install.sh'], { env, encoding: 'utf8' });
      let result = install();
      assert.equal(result.status, 0, result.stderr);
      const target = path.join(prefix, 'bin/starfall-command');
      assert.equal(await fs.readFile(target, 'utf8'), 'first fixture game');
      assert.ok(
        (await fs.readFile(path.join(prefix, 'share/applications/starfall-command.desktop'), 'utf8')).includes(
          `Exec="${target}"`,
        ),
      );
      const saves = path.join(temp, 'home', '.config', 'Starfall Command', 'operations');
      await fs.mkdir(saves, { recursive: true });
      await fs.writeFile(path.join(saves, 'sentinel.json'), 'player progress');
      await fs.writeFile(path.join(source, asset), 'second fixture game');
      await writeChecksums(source, [asset, 'icon.png']);
      result = install();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await fs.readFile(target, 'utf8'), 'second fixture game');
      assert.equal(await fs.readFile(path.join(saves, 'sentinel.json'), 'utf8'), 'player progress');
      await fs.writeFile(path.join(source, asset), 'tampered');
      result = install();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Checksum mismatch/);
      assert.equal(await fs.readFile(target, 'utf8'), 'second fixture game');
      await fs.rm(path.join(source, 'checksums.txt'));
      result = install();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /checksums are unavailable/);
      assert.equal(await fs.readFile(target, 'utf8'), 'second fixture game');
      const unrelated = path.join(temp, 'unrelated');
      await fs.mkdir(path.join(unrelated, 'bin'), { recursive: true });
      await fs.writeFile(path.join(unrelated, 'bin/starfall-command'), 'not our application');
      await writeChecksums(source, [asset, 'icon.png']);
      const refused = spawnSync('sh', ['scripts/install.sh'], {
        env: { ...env, STARFALL_PREFIX: unrelated },
        encoding: 'utf8',
      });
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /not a known Starfall/);
      assert.equal(await fs.readFile(path.join(unrelated, 'bin/starfall-command'), 'utf8'), 'not our application');
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
