import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REPO, expectedAssets, trustedRun, metadata, skipRelease, verifyInstallers, writeChecksums, sha256 } from './release-contract.mjs';

const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
function api(endpoint, missingOK = false) {
  const result = spawnSync('gh', ['api', `repos/${REPO}/${endpoint}`], { encoding: 'utf8' });
  let data; try { data = JSON.parse(result.stdout); } catch { /* Report the actual CLI failure below. */ }
  if (result.status === 0) return data;
  if (missingOK && data?.status === '404') return null;
  throw Error(result.stderr || 'GitHub API returned no data');
}
function releaseFor(tag) {
  // GET /releases/tags/:tag excludes drafts, even for the owner. List releases to find resumable drafts.
  return JSON.parse(gh(['api', `repos/${REPO}/releases?per_page=100`, '--paginate', '--slurp'])).flat().find(release => release.tag_name === tag) || null;
}
async function publish() {
  if (process.env.GITHUB_REPOSITORY !== REPO || !/^\d+$/.test(process.env.CI_RUN_ID || '')) throw Error('Expected the Starfall repository and a numeric CI run ID');
  const run = api(`actions/runs/${process.env.CI_RUN_ID}`), current = await metadata();
  if (!trustedRun(run, process.env.GITHUB_REPOSITORY, current.sha)) throw Error('Refusing to publish: CI must be successful, from a main push in this repository, and match the checked-out commit');
  const isCurrent = () => api('git/ref/heads/main').object.sha === current.sha;
  if (!isCurrent()) { console.log('A newer main commit exists; this release is superseded.'); return; }
  const message = execFileSync('git', ['log', '-1', '--format=%B'], { encoding: 'utf8' });
  if (skipRelease(message)) { console.log('Skip-Release trailer present; not publishing.'); return; }
  const tag = `v${current.version}`, existing = releaseFor(tag), tagRef = api(`git/ref/tags/${tag}`, true);
  const tagCommit = tagRef ? api(`commits/${tag}`) : null;
  if (tagCommit && tagCommit.sha !== current.sha) throw Error('Release tag already points to another commit');
  if (existing && !existing.draft) { console.log(`${tag} is already published; immutable assets were not changed.`); return; }
  if (existing && existing.target_commitish !== current.sha) throw Error('Draft release targets another commit');

  const temp = await mkdtemp(path.join(os.tmpdir(), 'starfall-publish-'));
  try {
    // RELEASE_PUBLISH_DIR keeps the verified upload set for post-publish provenance attestation.
    const incoming = path.join(temp, 'incoming');
    const out = process.env.RELEASE_PUBLISH_DIR ? path.resolve(process.env.RELEASE_PUBLISH_DIR) : path.join(temp, 'out');
    await mkdir(out, { recursive: true });
    gh(['run', 'download', String(run.id), '--repo', REPO, '--dir', incoming, '--pattern', 'installers-*', '--pattern', 'release-metadata']);
    const tested = JSON.parse(await readFile(path.join(incoming, 'release-metadata/release-info.json'), 'utf8'));
    if (tested.sha !== current.sha || tested.version !== current.version) throw Error('CI artifact provenance/version mismatch');
    for (const platform of ['mac', 'linux', 'win']) {
      const directory = path.join(incoming, `installers-${platform}`);
      await verifyInstallers(directory, tested.version, platform);
      for (const name of expectedAssets(tested.version, platform)) await copyFile(path.join(directory, name), path.join(out, name));
    }
    await copyFile('scripts/install.sh', path.join(out, 'install.sh'));
    await copyFile('assets/generated/app-icon.png', path.join(out, 'icon.png'));
    await writeFile(path.join(out, 'release-info.json'), JSON.stringify({ ...tested, ciRun: run.html_url }, null, 2) + '\n');
    const names = [...expectedAssets(tested.version), 'install.sh', 'icon.png', 'release-info.json'];
    await writeChecksums(out, names); names.push('checksums.txt');
    if (!isCurrent()) { console.log('New main commit arrived during download; not publishing a superseded build.'); return; }
    if (!existing) gh(['release', 'create', tag, '--repo', REPO, '--draft', '--target', tested.sha, '--title', `Starfall Command ${tested.version}`, '--notes', 'Verifying release assets.']);
    gh(['release', 'upload', tag, '--repo', REPO, '--clobber', ...names.map(name => path.join(out, name))]);
    const uploaded = releaseFor(tag);
    if (uploaded.assets.length !== names.length) throw Error('Draft has missing or unexpected assets');
    for (const name of names) {
      const asset = uploaded.assets.find(asset => asset.name === name);
      if (!asset || asset.digest !== 'sha256:' + await sha256(path.join(out, name))) throw Error('Remote asset digest mismatch: ' + name);
    }
    if (!isCurrent()) { console.log('New main commit arrived during upload; completed draft remains unpublished.'); return; }
    const notes = `Built from main @ ${tested.sha}. [Verified CI run](${run.html_url}).\n\n## Install\n\nmacOS / Linux:\n\n\`\`\`sh\ncurl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh\n\`\`\`\n\nOr download the matching DMG/ZIP (Apple Silicon or Intel), AppImage/DEB (x64 or arm64), or Windows x64 EXE below. No Node installation needed.\n\nSave and quit the game before upgrading. Reinstalling preserves your operation library. The installer verifies SHA-256 checksums and never disables Gatekeeper or deletes saves.\n\nMac builds are ad-hoc signed unless Apple signing/notarization secrets are configured; macOS may require Privacy & Security → Open Anyway. Windows builds are unsigned and may trigger SmartScreen. No in-app automatic updater is included.\n\n[Install, signing, and rollback guide](https://github.com/${REPO}/blob/${tested.sha}/docs/RELEASING.md).\n`;
    const notesFile = path.join(temp, 'notes.md'); await writeFile(notesFile, notes);
    gh(['release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest', '--notes-file', notesFile]);
    const published = api(`releases/tags/${tag}`);
    if (published.draft || published.assets.length !== names.length) throw Error('Release did not become public with its full asset set');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'published=true\n');
    console.log('Published and verified: ' + published.html_url);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
await publish();
