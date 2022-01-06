# Supress initial last login message
touch ~/.hushlogin

# Remove initial dotfiles 
rm ~/.vim/coc-settings.json
rm ~/.zshrc
rm ~/.vimrc


# Symlinks to dotfiles
ln -s ~/dotfiles/.zshrc ~/.zshrc 
ln -s ~/dotfiles/.vimrc ~/.vimrc
ln -s ~/dotfiles/coc-settings.json ~/.vim/coc-settings.json
