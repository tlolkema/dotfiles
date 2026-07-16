DOTFILES=~/dotfiles

# Run Pi inside the macOS Seatbelt sandbox. The startup directory is writable,
# host files are readable, and Safehouse keeps selected Pi/tool caches writable.
# Playwright uses the outer Seatbelt sandbox instead of Chromium's nested one.
# The appended profile permits playwright-cli control sockets in macOS's temp dir.
pi() {
    safehouse \
        --enable=wide-read,playwright-chrome \
        --append-profile="$DOTFILES/safehouse/playwright-cli.sb" \
        -- pi "$@"
}

swap() {
    "$DOTFILES/scripts/arrange-displays" "$1"
}
