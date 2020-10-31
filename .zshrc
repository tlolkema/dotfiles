# main
ZSH_THEME=robbyrussell
export CLICOLOR=1
export LSCOLORS=ExFxBxDxCxegedabagacad

# locale
export LC_ALL=en_US.UTF-8

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
alias cat="ccat $*"
alias cat0="/bin/cat $*" # for cases when you need plain `cat`

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
bindkey "ç" fzf-cd-widget
alias fzf=fzf-cd-widget

# Use vim editing mode in terminal [escape to enter normal mode]
bindkey -v

# Restore some keymaps removed by vim keybind mode
bindkey '^P' up-history
bindkey '^N' down-history
bindkey '^?' backward-delete-char
bindkey '^h' backward-delete-char
bindkey '^w' backward-kill-word

# Dependencies for the following lines
zmodload zsh/zle
autoload -U colors && colors

# And also a beam as the cursor
echo -ne '\e[5 q'

# Callback for vim mode change
function zle-keymap-select () {
    # Only supported in these terminals
    if [ "$TERM" = "xterm-256color" ] || [ "$TERM" = "xterm-kitty" ] || [ "$TERM" = "screen-256color" ]; then
        if [ $KEYMAP = vicmd ]; then
            # Set block cursor
            echo -ne '\e[1 q'
        else
            # Set beam cursor
            echo -ne '\e[5 q'
        fi
    fi
}

# Bind the callback
zle -N zle-keymap-select

# Reduce latency when pressing <Esc>
export KEYTIMEOUT=1

# Syntax highlighting
source ~/.zsh/zsh-z.plugin.zsh
source ~/.zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

