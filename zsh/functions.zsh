DOTFILES=~/dotfiles

ai() {
    if [ -n "$1" ]
    then
        sh "$DOTFILES/scripts/openai.sh" "$1"
    fi
}

NOTES_DIR=~/Documents/Notes

note() {
    if [ -n "$1" ]
    then
        printf "- $1\n\n" >> "$NOTES_DIR/notes.md" 
    fi
}
