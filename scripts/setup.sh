#!/usr/bin/env bash

set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This setup script supports macOS only." >&2
  exit 1
fi

# Suppress the initial "Last login" message.
touch "$HOME/.hushlogin"

# Install Homebrew when it is not available yet.
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

brew bundle --file "$DOTFILES/homebrew/Brewfile"

# Install a Node runtime through fnm and install pi.
eval "$(fnm env)"
fnm install 24
fnm default 24
npm install --global @earendil-works/pi-coding-agent

# Zap's installer may create .zshrc, so install it before linking dotfiles.
if [[ ! -f "$HOME/.local/share/zap/zap.zsh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/zap-zsh/zap/master/install.zsh | zsh
fi

"$DOTFILES/scripts/symlinks.sh"

# Configure an immediate, automatically hidden Dock.
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0
killall Dock >/dev/null 2>&1 || true

echo "Setup complete. Open a new shell to load the configuration."
