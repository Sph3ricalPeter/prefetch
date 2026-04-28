#!/bin/sh
# Prefetch installer for macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/Sph3ricalPeter/prefetch/main/install.sh | sh
set -e

REPO="Sph3ricalPeter/prefetch"

echo ""
echo "  Prefetch — installing latest release..."
echo ""

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) PATTERN="aarch64.dmg" ;;
  x86_64)        PATTERN="x64.dmg" ;;
  *)
    echo "  Error: unsupported architecture $ARCH" >&2
    exit 1
    ;;
esac

# Get latest release info
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*: "//;s/".*//')
echo "  Version: $VERSION"

# Find the right DMG asset URL
URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep "$PATTERN" | head -1 | sed 's/.*: "//;s/".*//')
if [ -z "$URL" ]; then
  echo "  Error: no macOS ($PATTERN) installer found in release $VERSION" >&2
  exit 1
fi

FILENAME=$(basename "$URL")
TMPDIR=$(mktemp -d)
DMG_PATH="$TMPDIR/$FILENAME"

# Download
echo "  Downloading $FILENAME..."
curl -fSL "$URL" -o "$DMG_PATH"

# Mount DMG
echo "  Installing to /Applications..."
HDIUTIL_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse 2>/dev/null) || true
MOUNT_POINT=$(echo "$HDIUTIL_OUTPUT" | grep -o '/Volumes/.*' | sed 's/[[:space:]]*$//') || true

if [ -z "$MOUNT_POINT" ]; then
  echo "  Error: failed to mount DMG" >&2
  echo "  hdiutil output: $HDIUTIL_OUTPUT" >&2
  exit 1
fi

# Find the .app inside the mounted volume
APP_NAME=$(ls "$MOUNT_POINT" | grep '\.app$' | head -1)
if [ -z "$APP_NAME" ]; then
  echo "  Error: no .app found in DMG" >&2
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null
  exit 1
fi

# Kill running instance if any
killall "$( echo "$APP_NAME" | sed 's/\.app$//' )" 2>/dev/null || true
sleep 1

# Remove old version if present
if [ -d "/Applications/$APP_NAME" ]; then
  echo "  Removing previous installation..."
  rm -rf "/Applications/$APP_NAME" 2>/dev/null || sudo rm -rf "/Applications/$APP_NAME"
fi

echo "  Copying $APP_NAME to /Applications..."
# Use ditto (preserves macOS metadata, resource forks, and code signatures)
sudo ditto "$MOUNT_POINT/$APP_NAME" "/Applications/$APP_NAME"
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || hdiutil detach "$MOUNT_POINT" 2>/dev/null

# Cleanup
rm -rf "$TMPDIR"

# Remove quarantine attribute so it opens without Gatekeeper warning
sudo xattr -rd com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true

# Re-register with Launch Services so macOS picks up the new version
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "/Applications/$APP_NAME" 2>/dev/null || true
fi

# Verify installation
if [ -d "/Applications/$APP_NAME" ]; then
  echo ""
  echo "  ✓ Prefetch $VERSION installed to /Applications/$APP_NAME"
  echo ""
else
  echo ""
  echo "  ✗ Installation failed — app not found in /Applications/" >&2
  echo ""
  exit 1
fi
