# Supress initial last login message
touch ~/.hushlogin

# Create .config directory if it doesn't exist
[ ! -d ~/.config ] && mkdir ~/.config

# Remove initial dotfiles if present
rm ~/.gitconfig
rm ~/.vim/coc-settings.json
rm ~/.zshrc
rm ~/.vimrc

# Symlinks to dotfiles
ln -s ~/dotfiles/vim/.vimrc ~/.vimrc
ln -s ~/dotfiles/zsh/.zshrc ~/.zshrc
ln -s ~/dotfiles/git/.gitconfig ~/.gitconfig

## Set defaults
defaults write com.apple.dock autohide -bool true && defaults write com.apple.dock autohide-delay -float 0 && defaults write com.apple.dock autohide-time-modifier -float 0 && killall Dock

# Install Zap
curl -sS https://raw.githubusercontent.com/zap-zsh/zap/master/install.zsh | zsh

# Get and install Starship theme
curl -sS https://starship.rs/install.sh | sh
