DOTFILES=~/dotfiles

ai() {
    if [ -n "$1" ]
    then
        sh "$DOTFILES/scripts/openai.sh" "$1"
    fi
}
