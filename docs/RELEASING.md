# Installable releases

Repository: <https://github.com/agustinsacco/starfall-command>

## Install and update

Download from [GitHub Releases](https://github.com/agustinsacco/starfall-command/releases/latest):

| Platform | Installers |
|---|---|
| macOS Apple Silicon / Intel | `.dmg` (drag to Applications), `.zip` |
| Linux x64 / arm64 | `.AppImage`, `.deb` |
| Windows x64 | `.exe` guided, per-user installer |

No Node installation is required to play. On macOS and Linux you can also run:

```sh
curl -fsSL https://github.com/agustinsacco/starfall-command/releases/latest/download/install.sh | sh
```

Save your operation and quit before upgrading. Rerunning the installer replaces the app, not its saved games. macOS installs to `~/Applications` by default; override with `STARFALL_INSTALL_DIR=/Applications`. Linux installs to `~/.local/bin/starfall-command` with a desktop entry; override with `STARFALL_PREFIX`.

For a review-before-execution alternative:

```sh
curl -fsSL https://github.com/agustinsacco/starfall-command/releases/latest/download/install.sh -o install.sh
less install.sh
sh install.sh
```

The script pins all downloads to one tag, requires matching SHA-256 checksums, refuses unrelated existing applications and symlinks, and never disables Gatekeeper or deletes saves. Mac replacement is staged on the destination filesystem with rollback on a failed final move. A concurrent install is blocked by `.starfall-install.lock`; after an interrupted installation, inspect that directory and any `.starfall-stage.*` recovery folder before removing a stale lock.

**Trust:** checksums detect damaged or mismatched downloads; they do not replace publisher trust or code-signing certificates. Checksum verification of a binary cannot retroactively authenticate a bootstrap script you have already executed.

Mac releases without Apple credentials are ad-hoc signed, not notarized. macOS may require **System Settings → Privacy & Security → Open Anyway**. Windows installers are unsigned and may trigger SmartScreen. Linux AppImages need FUSE support; use the `.deb` or `--appimage-extract-and-run` if FUSE is unavailable. No in-app updater is included: rerun the installer or download the next release.

## How releases work

1. **CI** runs for PRs, pushes to `main`, and manual test runs. It checks source and simulation/persistence/release tests on macOS, Linux and Windows, then builds all nine installers. The packaged Mac app additionally runs the native gameplay/save/relaunch suite and Chrome interaction checks.
2. The version is `<package major>.<package minor>.<first-parent commit count>`, such as `2.0.2`. The patch is managed by CI. No version-bump commits are made. `release-info.json` records the exact tested commit and version.
3. **Release** accepts only a successful `CI` run from a **push to this repository's `main`**, not a PR, fork, failed build, or manual CI preview. It also checks that the run matches the current main commit. Superseded runs do not publish.
4. The publisher downloads the **exact CI artifacts**, rather than rebuilding potentially different bytes. All nine installers must be present. It attaches the install script, icon, commit metadata and `checksums.txt`.
5. Only one publisher runs at a time. It uploads to a draft, verifies every uploaded SHA-256 digest against GitHub's asset metadata, and publishes only after the complete set passes. No partially populated release becomes “Latest.”

A failed platform blocks publication; successful platforms remain available as CI artifacts for one day. Failed publication leaves a draft, not a broken latest release. Retrying resumes that draft. Published assets and tags are never overwritten by the workflow. GitHub tags are created at the exact tested commit when the release is published.

### Deliberately skip a release

Use a real trailer at the end of the main commit (for squash merges, in the squash commit message):

```text
Documentation maintenance

Skip-Release: true
```

Mentioning the directive in ordinary prose does not skip publication. CI still runs.

### Retry

Rerun the failed **Release** job, or, while its CI artifacts still exist:

```sh
gh workflow run release.yml --repo agustinsacco/starfall-command --ref main -f ci_run_id=SUCCESSFUL_MAIN_CI_RUN_ID
```

Manual publication revalidates the run; it cannot bypass CI, publish a feature branch, or publish an older commit over a newer main. If artifacts expired, rerun the original main-push CI run first. Existing published versions are a no-op.

## Local builds

```sh
npm ci
npm run check
npm test
npm run dist:mac      # DMG + ZIP, Apple Silicon and Intel
npm run dist:linux    # AppImage + DEB, x64 and arm64 (run on Linux)
npm run dist:win      # NSIS EXE, x64 (run on Windows)
```

Output is in ignored `release/`; `dist/` remains the earlier local-only Mac packager's output. `npm run dist:mac -- --arm64` builds just Apple Silicon. Set `RELEASE_VERSION=2.0.2` to stamp a specific stable version. All package commands use `--publish never` so local testing and PRs cannot accidentally ship a release.

To test a packaged Apple Silicon build:

```sh
STARFALL_EXECUTABLE="$PWD/release/mac-arm64/Starfall Command.app/Contents/MacOS/Starfall Command" \
STARFALL_EXPECTED_VERSION=2.0.0 npm run test:electron
```

Use `release/mac/` on Intel, and the stamped version if overridden. Tests use isolated save directories. The native test driver emulates browser focus so switching applications does not pause the timed fixtures; production pause-on-blur remains unchanged. Other OS installers are built and their core simulation/storage code is tested in CI; the full native UI suite is currently Mac-only.

## Optional Apple signing

Add these **to this repository's Actions secrets**, not to files or commits:

- `MAC_CERT_P12`: base64 Developer ID Application `.p12` certificate.
- `MAC_CERT_PASSWORD`: certificate password.
- `APPLE_ID`: Apple account email.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password.
- `APPLE_TEAM_ID`: developer team ID.

Only macOS builds triggered by a push to `main` receive them. PRs and manual CI previews never receive signing secrets. When the certificate is present, all five values are required, hardened runtime and notarization are enabled, and signing failure blocks release. Without a certificate, the build explicitly requests ad-hoc signing and verifies its resource seal. No credentials are copied from pidex or read from local keychains automatically. Signing/notarization with a real Developer ID must be verified after the owner configures these secrets.

## Rollback and data safety

A release changes only this game's GitHub assets and installed application. It does not deploy a service, change pidex, migrate save formats, or touch an operation directory. The bundle ID remains `com.starfall.command`; the data directory remains `Starfall Command` under Electron's platform app-data directory.

To reinstall a known-good published version, save/quit and run:

```sh
curl -fsSL https://github.com/agustinsacco/starfall-command/releases/download/v2.0.2/install.sh -o install.sh
STARFALL_VERSION=v2.0.2 sh install.sh
```

Substitute an existing version. Export important operations first: a future save-format upgrade may make old binaries unable to load newer snapshots. This release tooling does not change the v2 save format. To suspend publication, disable **Release** in Actions; no running game is affected. Moving “Latest” back to an older release is a separate owner action, not done automatically by this workflow.

## Reference

Adapted from pidex's CI-gated release model and installer conventions. Starfall differs deliberately: every release includes Windows, all platforms must succeed, no in-app updater is added, checksums are mandatory, and installers do not remove macOS quarantine protections. The publisher has repository-content write permission; test/build jobs have read-only repository access. Package inputs are allowlisted, excluding tests, credentials, saved games and development dependencies.
