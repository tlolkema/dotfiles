#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Homebrew background updates require macOS." >&2
  exit 1
fi

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.timlolkema.homebrew-autoupdate"
DOMAIN="gui/$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"

mkdir -p "$AGENTS_DIR"
TEMP_PLIST="$(mktemp "$AGENTS_DIR/.homebrew-autoupdate.XXXXXX")"
trap 'rm -f "$TEMP_PLIST"' EXIT

/usr/bin/plutil -create xml1 "$TEMP_PLIST"
/usr/bin/plutil -insert Label -string "$LABEL" "$TEMP_PLIST"
/usr/bin/plutil -insert ProgramArguments -json '["/bin/bash"]' "$TEMP_PLIST"
/usr/bin/plutil -insert ProgramArguments.1 -string "$DOTFILES/homebrew/auto-update.sh" "$TEMP_PLIST"
/usr/bin/plutil -insert StartInterval -integer 7200 "$TEMP_PLIST"
/usr/bin/plutil -insert ProcessType -string Background "$TEMP_PLIST"
/usr/bin/plutil -insert LowPriorityIO -bool YES "$TEMP_PLIST"
/usr/bin/plutil -insert Nice -integer 10 "$TEMP_PLIST"
/usr/bin/plutil -insert StandardOutPath -string /dev/null "$TEMP_PLIST"
/usr/bin/plutil -insert StandardErrorPath -string /dev/null "$TEMP_PLIST"
/usr/bin/plutil -lint "$TEMP_PLIST"

# Reload the job on reinstall without starting an upgrade immediately.
if /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  /bin/launchctl bootout "$DOMAIN/$LABEL"
fi
chmod 644 "$TEMP_PLIST"
mv "$TEMP_PLIST" "$PLIST"
/bin/launchctl enable "$DOMAIN/$LABEL"
/bin/launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Homebrew background updates enabled every two hours while logged in."
