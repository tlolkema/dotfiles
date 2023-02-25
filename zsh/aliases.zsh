DOTFILES=~/dotfiles

# Aliasses
alias activate="source env/bin/activate"
alias zshconfig="vim $DOTFILES/zsh/.zshrc"
alias cl=clear
alias vim=nvim
alias lg=lazygit
alias cat=bat
alias nvm=fnm

# Git aliasses
alias gst="git status"
alias gaa="git add ."
alias gfu="git fetch upstream"
alias gfo="git fetch origin"
alias gru="git rebase upstream/master"
alias gro="git rebase origin/main"
alias gca="git commit --amend --no-edit"
