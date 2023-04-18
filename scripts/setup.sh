# Supress initial last login message
touch ~/.hushlogin

# Create .config directory if it doesn't exist
[ ! -d ~/.config ] && mkdir ~/.config

# Create .config/nvim directory and init.lua file if it doesn't exist
[ ! -f ~/.config/nvim/init.lua ] && mkdir ~/.config/nvim && touch ~/.config/nvim/init.lua

# Remove initial dotfiles if present
rm ~/.config/nvim/init.lua
rm ~/.zshrc
rm ~/.gitconfig

# Symlinks to dotfiles
ln -s ~/dotfiles/nvim/init.lua ~/.config/nvim/init.lua
ln -s ~/dotfiles/zsh/.zshrc ~/.zshrc
ln -s ~/dotfiles/git/.gitconfig ~/.gitignore

## Set defaults
defaults write com.apple.dock autohide -bool true && defaults write com.apple.dock autohide-delay -float 0 && defaults write com.apple.dock autohide-time-modifier -float 0 && killall Dock

# Install Zap
curl -sS https://raw.githubusercontent.com/zap-zsh/zap/master/install.zsh | zsh

# Get and install Starship theme
curl -sS https://starship.rs/install.sh | sh
