# Create .config directory if it doesn't exist
[ ! -d ~/.config ] && mkdir ~/.config

# Remove initial dotfiles if present
rm ~/.gitconfig
rm ~/.zshrc
rm ~/.vimrc
rm ~/.config/ghostty/config

# Symlinks to dotfiles
ln -fs ~/dotfiles/vim/.vimrc ~/.vimrc
ln -fs ~/dotfiles/zsh/.zshrc ~/.zshrc
ln -fs ~/dotfiles/git/.gitconfig ~/.gitconfig
ln -fs ~/dotfiles/ghostty/config ~/.config/ghostty/config
