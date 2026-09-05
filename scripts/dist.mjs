import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertVersion } from './release-contract.mjs';

const require = createRequire(import.meta.url), platform = process.argv[2];
if (!['mac', 'linux', 'win'].includes(platform)) throw Error('Usage: node scripts/dist.mjs mac|linux|win [--arm64|--x64] [--dir]');
const options = process.argv.slice(3);
if (options.some(arg => !['--arm64', '--x64', '--dir'].includes(arg))) throw Error('Unsupported packaging option');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = assertVersion(process.env.RELEASE_VERSION || pkg.version), env = { ...process.env };
delete env.CSC_FOR_PULL_REQUEST;
const args = [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.json', '--publish', 'never', `--${platform}`, `--config.extraMetadata.version=${version}`];
args.push(...(options.some(arg => ['--arm64', '--x64'].includes(arg)) ? [] : platform === 'win' ? ['--x64'] : ['--arm64', '--x64']), ...options);
// Missing GitHub secrets arrive as empty strings. Never let the builder interpret one as a certificate path.
const appleKeys = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
if (platform === 'mac' && env.CSC_LINK) {
  if (appleKeys.some(key => !env[key])) throw Error('Signed distribution requires all five Apple signing/notarization variables');
  args.push('--config.mac.hardenedRuntime=true', '--config.mac.notarize=true', '--config.forceCodeSigning=true');
} else {
  for (const key of appleKeys) delete env[key];
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  if (platform === 'mac') {
    // electron-builder otherwise skips even identity=- on PRs. Safe ONLY after removing credentials above.
    env.CSC_FOR_PULL_REQUEST = 'true';
    args.push('--config.mac.identity=-', '--config.mac.notarize=false');
  }
}
execFileSync(process.execPath, args, { env, stdio: 'inherit', timeout: 25 * 60 * 1000 });
if (platform === 'mac') {
  let verified = 0;
  for (const entry of await readdir('release')) if (/^mac(?:-arm64)?$/.test(entry)) {
    const app = path.join('release', entry, 'Starfall Command.app');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    verified++;
  }
  if (!verified) throw Error('No packaged Mac application found');
  console.log(`Verified ${verified} macOS bundle signature(s).`);
}
