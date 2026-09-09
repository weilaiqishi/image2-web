#!/bin/bash
# Verify the actual distributed app, including its sealed bundle resources.
set -euo pipefail

dmg="$1"
expected_version="$2"
mount_dir="$(mktemp -d)"
cleanup() {
  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  rmdir "$mount_dir" || true
}
trap cleanup EXIT

hdiutil verify "$dmg"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg"
app="$mount_dir/Image2 Studio.app"
test -d "$app"
test -x "$app/Contents/MacOS/image2-studio"
codesign --verify --deep --strict --verbose=2 "$app"
test -f "$app/Contents/_CodeSignature/CodeResources"
actual_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
test "$actual_version" = "$expected_version"
echo "Verified installer: $dmg (version $actual_version)"
