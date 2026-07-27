#!/usr/bin/env bash

set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

brew update
brew upgrade
brew bundle --file "$DOTFILES/homebrew/Brewfile"
