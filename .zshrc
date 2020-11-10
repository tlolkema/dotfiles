# locale
export LC_ALL=en_US.UTF-8

# dotfiles
DOTFILES=~/dotfiles

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

#antigen
source $DOTFILES/antigen.zsh 
antigen use oh-my-zsh
antigen bundle z
antigen bundle git-flow
antigen theme jackharrisonsherlock/common
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/zsh-syntax-highlighting
antigen apply

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

DISABLE_AUTO_TITLE="true"


