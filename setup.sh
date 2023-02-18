# Supress initial last login message
touch ~/.hushlogin

# Remove initial dotfiles if present
rm ~/.zshrc

# Symlinks to dotfiles
ln -s ~/dotfiles/nvim/init.lua ~/.config/nvim/init.lua
ln -s ~/dotfiles/.zshrc ~/.zshrc 
