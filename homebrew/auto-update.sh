#!/usr/bin/env bash

set -euo pipefail

# launchd does not load the interactive shell's environment.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CI=1
export NONINTERACTIVE=1
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ANALYTICS=1
# Never request administrator access from a background job.
export HOMEBREW_NO_SUDO=1
export SUDO_ASKPASS=/usr/bin/false

LOG_FILE="$HOME/Library/Logs/homebrew-autoupdate.log"
mkdir -p "$(dirname "$LOG_FILE")"
# Keep only the latest run so the log cannot grow indefinitely.
exec >"$LOG_FILE" 2>&1
exec </dev/null
trap 'status=$?; printf "Finished: %s (exit %s)\n" "$(date)" "$status"' EXIT

printf 'Started: %s\n' "$(date)"
brew update
# Include casks that auto-update or use an unversioned "latest" release.
brew upgrade --greedy
