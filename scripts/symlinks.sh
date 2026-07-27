#!/usr/bin/env bash

set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SUFFIX="backup-$(date +%Y%m%d%H%M%S)"

link_dotfile() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    local backup="${target}.${BACKUP_SUFFIX}"
    echo "Backing up $target to $backup"
    mv "$target" "$backup"
  fi

  ln -s "$source" "$target"
  echo "Linked $target"
}

link_dotfile "$DOTFILES/vim/.vimrc" "$HOME/.vimrc"
link_dotfile "$DOTFILES/vim/coc-settings.json" "$HOME/.vim/coc-settings.json"
link_dotfile "$DOTFILES/zsh/.zshrc" "$HOME/.zshrc"
link_dotfile "$DOTFILES/git/.gitconfig" "$HOME/.gitconfig"
link_dotfile "$DOTFILES/ghostty/config" "$HOME/.config/ghostty/config"
link_dotfile "$DOTFILES/herdr/config.toml" "$HOME/.config/herdr/config.toml"
link_dotfile "$DOTFILES/hunk/config.toml" "$HOME/.config/hunk/config.toml"
link_dotfile "$DOTFILES/zed/settings.json" "$HOME/.config/zed/settings.json"
link_dotfile "$DOTFILES/pi/settings.json" "$HOME/.pi/agent/settings.json"
link_dotfile "$DOTFILES/pi/extensions" "$HOME/.pi/agent/extensions"
link_dotfile "$DOTFILES/pi/themes" "$HOME/.pi/agent/themes"
