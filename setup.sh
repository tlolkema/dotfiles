# Supress initial last login message
touch ~/.hushlogin

# Create .config directory if it doesn't exist
if [ ! -d ~/.config ] ; then
    mkdir ~/.config
fi

# Create .config/nvim directory and init.lua file if it doesn't exist
if [ ! -f ~/.config/nvim/init.lua ] ; then
    mkdir ~/.config/nvim
    touch ~/.config/nvim/init.lua
fi

# Remove initial dotfiles if present
rm ~/.config/nvim/init.lua
rm ~/.zshrc

# Symlinks to dotfiles
ln -s ~/dotfiles/nvim/init.lua ~/.config/nvim/init.lua
ln -s ~/dotfiles/.zshrc ~/.zshrc

# Install Zap
curl -sS https://raw.githubusercontent.com/zap-zsh/zap/master/install.zsh | zsh

# Get and install Starship theme
curl -sS https://starship.rs/install.sh | sh
