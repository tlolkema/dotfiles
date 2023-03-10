DOTFILES=~/dotfiles

ai() {
    [ -n "$1" ] && sh "$DOTFILES/scripts/openai.sh" "$1"
}

rewrite() {
    [ -n "$1" ] && sh "$DOTFILES/scripts/openai.sh" "rewrite this: $1"
}

NOTES_DIR=~/Documents/Notes

note() {
    [ -n "$1" ] && printf "- $1\n\n" >> "$NOTES_DIR/notes.md" 
}
