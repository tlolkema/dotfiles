# Create config directories if they don't exist
mkdir -p ~/.config ~/.pi/agent

# Remove initial dotfiles if present
rm ~/.gitconfig
rm ~/.zshrc
rm ~/.vimrc
rm ~/.config/ghostty/config
rm ~/.config/herdr/config.toml
rm ~/.config/hunk/config.toml
rm -f ~/.pi/agent/settings.json
rm -rf ~/.pi/agent/extensions ~/.pi/agent/themes

# Symlinks to dotfiles
ln -fs ~/dotfiles/vim/.vimrc ~/.vimrc
ln -fs ~/dotfiles/zsh/.zshrc ~/.zshrc
ln -fs ~/dotfiles/git/.gitconfig ~/.gitconfig
ln -fs ~/dotfiles/ghostty/config ~/.config/ghostty/config
ln -fs ~/dotfiles/herdr/config.toml ~/.config/herdr/config.toml
ln -fs ~/dotfiles/hunk/config.toml ~/.config/hunk/config.toml
ln -fs ~/dotfiles/pi/settings.json ~/.pi/agent/settings.json
ln -fs ~/dotfiles/pi/extensions ~/.pi/agent/extensions
ln -fs ~/dotfiles/pi/themes ~/.pi/agent/themes
ln -fs ~/dotfiles/aerospace/.aerospace.toml ~/.aerospace.toml
