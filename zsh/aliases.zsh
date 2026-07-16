DOTFILES=~/dotfiles

# Aliasses
alias activate="source env/bin/activate"
alias sourcezsh="source $DOTFILES/zsh/.zshrc"
alias zshconfig="vim $DOTFILES/zsh/.zshrc"
alias code="zed"

alias cl=clear
alias lg=lazygit
alias cat=bat
alias nvm=fnm
alias docker=podman

function git() {
  case "$1" in
    diff)
      shift
      hunk diff --watch "$@"
      ;;
    show)
      shift
      hunk show "$@"
      ;;
    *)
      command git "$@"
      ;;
  esac
}
