" .vimrc

" autoload vim-plug
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" install plugins
call plug#begin('~/.vim/bundle')

"" fzf - fuzzy finder
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'

"" ale - linter
Plug 'dense-analysis/ale'

"" syntax highlighting
Plug 'sheerun/vim-polyglot'

"" theme
Plug 'joshdick/onedark.vim'

"" auto completion
Plug 'neoclide/coc.nvim', {'do': { -> coc#util#install()}}

call plug#end()

syntax on
colorscheme onedark
set number

" remappings
nnoremap <expr> <C-p> (len(system('git rev-parse')) ? ':Files' : ':GFiles --exclude-standard --others --cached')."\<cr>"

" linting
let g:ale_linters = {'javascript': ['eslint'],'python': ['pylint']}

