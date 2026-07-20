# Create .config directory if it doesn't exist
[ ! -d ~/.config ] && mkdir ~/.config

# Remove initial dotfiles if present
rm ~/.gitconfig
rm ~/.zshrc
rm ~/.vimrc
rm ~/.config/ghostty/config
rm ~/.config/herdr/config.toml
rm ~/.config/hunk/config.toml

# Symlinks to dotfiles
ln -fs ~/dotfiles/vim/.vimrc ~/.vimrc
ln -fs ~/dotfiles/zsh/.zshrc ~/.zshrc
ln -fs ~/dotfiles/git/.gitconfig ~/.gitconfig
ln -fs ~/dotfiles/ghostty/config ~/.config/ghostty/config
ln -fs ~/dotfiles/herdr/config.toml ~/.config/herdr/config.toml
ln -fs ~/dotfiles/hunk/config.toml ~/.config/hunk/config.toml
ln -fs ~/dotfiles/aerospace/.aerospace.toml ~/.aerospace.toml
