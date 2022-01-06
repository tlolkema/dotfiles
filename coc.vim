"" CoC Vim Config

let g:coc_global_extensions = ['coc-jedi', 'coc-tsserver', 'coc-prettier'] 

" Bigger messages display.
set cmdheight=1

" Faster diagnostic messages (defaults 4000)
set updatetime=200

" Remap keys for applying codeAction to the current line.
nmap <leader>ac  <Plug>(coc-codeaction)

" Apply AutoFix to problem on the current line.
nmap <leader>qf  <Plug>(coc-fix-current)

" GoTo code navigation.
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
