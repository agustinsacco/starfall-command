#!/bin/sh
# Starfall installer. Downloads are pinned to ONE release and checksum verification is mandatory.
# STARFALL_VERSION=v2.0.N selects a previous release. Default is the latest published release.
# macOS: STARFALL_INSTALL_DIR (default ~/Applications). Linux: STARFALL_PREFIX (default ~/.local).
set -eu
REPO=agustinsacco/starfall-command
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }
valid_version() { printf '%s\n' "$1" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || die 'Invalid release version'; }
asset_name() {
  valid_version "$3"
  case "$2" in x86_64|amd64|x64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "Unsupported architecture: $2" ;; esac
  case "$1" in
    Darwin) printf 'starfall-command-%s-mac-%s.dmg\n' "$3" "$arch" ;;
    Linux) [ "$arch" != x64 ] || arch=x86_64; printf 'starfall-command-%s-linux-%s.AppImage\n' "$3" "$arch" ;;
    *) die "Unsupported OS: $1. Windows: download the .exe from GitHub Releases." ;;
  esac
}
# Used by the release contract tests: no network or filesystem mutations.
if [ "${1:-}" = --print-asset ]; then
  [ "$#" = 4 ] || die 'Usage: --print-asset Darwin|Linux ARCH VERSION'
  asset_name "$2" "$3" "$4"; exit 0
fi
[ "$#" = 0 ] || die 'Unknown installer argument'
for cmd in curl uname grep awk mktemp; do need "$cmd"; done
if command -v sha256sum >/dev/null 2>&1; then HASH=sha256sum
elif command -v shasum >/dev/null 2>&1; then HASH=shasum
else die 'Install sha256sum or shasum first; unverified installation is not allowed'; fi
OS=$(uname -s); ARCH=$(uname -m)
case "$OS" in Darwin|Linux) ;; *) die 'Windows: download the .exe installer from GitHub Releases.' ;; esac
TAG=${STARFALL_VERSION:-}
if [ -z "$TAG" ]; then
  URL=$(curl -q -fsSLI --proto '=https' --tlsv1.2 -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
  TAG=${URL##*/}
fi
case "$TAG" in v*) VERSION=${TAG#v} ;; *) die 'Expected a release tag such as v2.0.2' ;; esac
valid_version "$VERSION"
ASSET=$(asset_name "$OS" "$ARCH" "$VERSION")
BASE="https://github.com/$REPO/releases/download/$TAG"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/starfall-install.XXXXXX")
MOUNT= STAGE= LOCK= TARGET=
cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" >/dev/null 2>&1 || true; fi
  if [ -n "$STAGE" ]; then
    if [ -e "$STAGE/previous.app" ] && [ ! -e "$TARGET" ]; then
      mv "$STAGE/previous.app" "$TARGET" || { printf 'Restore the previous app from %s\n' "$STAGE" >&2; return; }
    fi
    rm -rf "$STAGE"
  fi
  [ -z "$LOCK" ] || rmdir "$LOCK" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM HUP
download() { curl -q -fsSL --proto '=https' --tlsv1.2 "$BASE/$1" -o "$TMP/$1"; }
verify() {
  expected=$(awk -v name="$1" '$2 == name {print $1; count++} END {if (count != 1) exit 1}' "$TMP/checksums.txt") || die "Missing/duplicate checksum for $1"
  printf '%s\n' "$expected" | grep -Eq '^[a-f0-9]{64}$' || die 'Malformed checksum'
  if [ "$HASH" = sha256sum ]; then actual=$(sha256sum "$TMP/$1" | awk '{print $1}')
  else actual=$(shasum -a 256 "$TMP/$1" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $1; existing installation was not changed"
}
info "Downloading $ASSET from $TAG"
download checksums.txt || die 'Release checksums are unavailable; refusing installation'
download "$ASSET"; verify "$ASSET"
if [ "$OS" = Linux ]; then download icon.png; verify icon.png; fi

if [ "$OS" = Darwin ]; then
  for cmd in hdiutil codesign ditto ps; do need "$cmd"; done
  DIR=${STARFALL_INSTALL_DIR:-$HOME/Applications}
  case "$DIR" in /*) ;; *) die 'STARFALL_INSTALL_DIR must be absolute' ;; esac
  [ "$DIR" != / ] || die 'Refusing to install in the filesystem root'
  mkdir -p "$DIR"
  if mkdir "$DIR/.starfall-install.lock" 2>/dev/null; then LOCK="$DIR/.starfall-install.lock"
  else die 'Another installation is active; inspect .starfall-install.lock before retrying'; fi
  TARGET="$DIR/Starfall Command.app"
  [ ! -L "$TARGET" ] || die 'Refusing to replace a symlink'
  if [ -e "$TARGET" ]; then
    ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET/Contents/Info.plist")
    [ "$ID" = com.starfall.command ] || die 'Destination is not a Starfall application'
  fi
  if ps -ax -o comm= | grep -F '/Starfall Command.app/Contents/MacOS/' >/dev/null; then
    die 'Save your operation and quit Starfall before installing an update'
  fi
  mkdir "$TMP/mount"
  MOUNT="$TMP/mount"
  hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$TMP/$ASSET" >/dev/null
  APP="$MOUNT/Starfall Command.app"
  [ -d "$APP" ] || die 'Disk image does not contain Starfall Command.app'
  ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
  APP_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
  [ "$ID" = com.starfall.command ] && [ "$APP_VERSION" = "$VERSION" ] || die 'Unexpected app identity/version'
  codesign --verify --deep --strict "$APP"
  STAGE=$(mktemp -d "$DIR/.starfall-stage.XXXXXX")
  ditto "$APP" "$STAGE/new.app"
  codesign --verify --deep --strict "$STAGE/new.app"
  [ ! -e "$TARGET" ] || mv "$TARGET" "$STAGE/previous.app"
  mv "$STAGE/new.app" "$TARGET"
  info "Installed $TAG to $TARGET"
  info 'If macOS blocks this ad-hoc-signed build, review Privacy & Security → Open Anyway. Security protections were not disabled.'
else
  PREFIX=${STARFALL_PREFIX:-$HOME/.local}
  case "$PREFIX" in /*) ;; *) die 'STARFALL_PREFIX must be absolute' ;; esac
  [ "$PREFIX" != / ] || die 'Refusing to install in the filesystem root'
  if printf '%s' "$PREFIX" | grep -Eq '[[:cntrl:]$`"\\%]'; then die 'Install prefix contains unsupported desktop-entry characters'; fi
  mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/starfall-command" "$PREFIX/share/icons/hicolor/512x512/apps"
  if mkdir "$PREFIX/.starfall-install.lock" 2>/dev/null; then LOCK="$PREFIX/.starfall-install.lock"
  else die 'Another installation is active; inspect .starfall-install.lock before retrying'; fi
  TARGET="$PREFIX/bin/starfall-command"
  [ ! -L "$TARGET" ] || die 'Refusing to replace a symlink'
  if [ -e "$TARGET" ]; then
    grep -qx com.starfall.command "$PREFIX/share/starfall-command/install-marker" 2>/dev/null || die 'Destination is not a known Starfall installation'
  fi
  STAGE=$(mktemp -d "$PREFIX/.starfall-stage.XXXXXX")
  cp "$TMP/$ASSET" "$STAGE/new.AppImage"; chmod 755 "$STAGE/new.AppImage"
  mv -f "$STAGE/new.AppImage" "$TARGET"
  printf 'com.starfall.command\n' > "$PREFIX/share/starfall-command/install-marker"
  cp "$TMP/icon.png" "$PREFIX/share/icons/hicolor/512x512/apps/starfall-command.png"
  printf '%s\n' '[Desktop Entry]' 'Name=Starfall Command' 'Comment=Single-player real-time strategy' "Exec=\"$TARGET\"" 'Icon=starfall-command' 'Terminal=false' 'Type=Application' 'Categories=Game;StrategyGame;' > "$PREFIX/share/applications/starfall-command.desktop"
  info "Installed $TAG to $TARGET"
  info 'AppImage needs FUSE support. If unavailable, use the .deb release or --appimage-extract-and-run.'
fi
info 'Your saved operations were not modified.'
