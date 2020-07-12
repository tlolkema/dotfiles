# main
ZSH_THEME=robbyrussell
export CLICOLOR=1
export LSCOLORS=ExFxBxDxCxegedabagacad

# dotfiles
DOTFILES=~/dotfiles
ZSH=$HOME/.oh-my-zsh

# aliasses
alias activate="source env/bin/activate"
alias vimconfig="vim $DOTFILES/.vimrc"
alias zshconfig="vim $DOTFILES/.zshrc"
alias bashconfig="vim $DOTFILES/.bashrc"
alias fzfconfig="vim $DOTFILES/.fzf.zsh"
alias cl=clear

# git aliasses
alias gst="git status"
alias gaa="git add ."
alias gfu="git fetch upstream"
alias gru="git rebase upstream/master"

#plugins
plugins=(git)

#source oh-my-zsh
source $ZSH/oh-my-zsh.sh

# fuzzy search
source $DOTFILES/.fzf.zsh
