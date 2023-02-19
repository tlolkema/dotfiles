# Locale
export LC_ALL=en_US.UTF-8

# Dotfiles
DOTFILES=~/dotfiles

# Set Starship prompt
eval "$(starship init zsh)"
export STARSHIP_CONFIG=$DOTFILES/starship.toml

# Aliasses
alias activate="source env/bin/activate"
alias zshconfig="vim $DOTFILES/.zshrc"
alias cl=clear
alias vim=nvim
alias lg=lazygit
alias cat=bat

# Git aliasses
alias gst="git status"
alias gaa="git add ."
alias gfu="git fetch upstream"
alias gfo="git fetch origin"
alias gru="git rebase upstream/master"
alias gro="git rebase origin/main"
alias gca="git commit --amend --no-edit"

# Plugins
[ -f "$HOME/.local/share/zap/zap.zsh" ] && source "$HOME/.local/share/zap/zap.zsh"
plug "zsh-users/zsh-autosuggestions"
plug "zsh-users/zsh-syntax-highlighting"
plug "hlissner/zsh-autopair"
plug "agkozak/zsh-z"

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
autoload -Uz compinit && compinit

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
