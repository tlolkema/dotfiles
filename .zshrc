# locale
export LC_ALL=en_US.UTF-8

# dotfiles
DOTFILES=~/dotfiles

# aliasses
alias activate="source env/bin/activate"
alias zshconfig="vim $DOTFILES/.zshrc"
alias bashconfig="vim $DOTFILES/.bashrc"
alias cl=clear
alias vim=nvim

# git aliasses
alias gst="git status"
alias gaa="git add ."
alias gfu="git fetch upstream"
alias gfo="git fetch origin"
alias gru="git rebase upstream/master"
alias gro="git rebase origin/main"
alias gca="git commit --amend --no-edit"

#antigen
source $DOTFILES/antigen.zsh 
antigen bundle z
antigen theme jackharrisonsherlock/common
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/zsh-syntax-highlighting
antigen apply

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

