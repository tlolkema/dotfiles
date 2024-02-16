" .vimrc
source ~/dotfiles/vim/coc.vim

"" quick typescript syntax highlighting
set re=0

" autoload vim-plug
if empty(glob('~/.vim/autoload/plug.vim'))
    silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
        \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
    autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" install plugins
call plug#begin('~/.vim/bundle')

"" syntax highlighting
Plug 'sheerun/vim-polyglot'

"" theme
Plug 'joshdick/onedark.vim'

"" completion & linting
Plug 'neoclide/coc.nvim', {'branch': 'release'}

call plug#end()

syntax on
colorscheme onedark
hi Normal ctermbg=none
set number relativenumber

" remappings
nnoremap <expr> <C-p> (len(system('git rev-parse')) ? ':Files' : ':GFiles --exclude-standard --others --cached')."\<cr>"

" auto bracket closing
inoremap " ""<left>
inoremap ' ''<left>
inoremap ( ()<left>
inoremap [ []<left>
inoremap { {}<left>
inoremap {<CR> {<CR>}<ESC>O
inoremap {;<CR> {<CR>};<ESC>O
