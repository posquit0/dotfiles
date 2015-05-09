" matlab.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/

" Set octave-friendly tabbing
set expandtab
set tabstop=4
set shiftwidth=4

" Type `K` in normal mode and the word under the cursor will be searched for in
" the GNU Octave documentation index. Pressing `,` yields the next occurrence
setlocal keywordprg=info\ octave\ --vi-keys\ --index-search

" Send current file to Octave
noremap <buffer> <F5> ggOpkg load all<esc>Gopause<esc>:w<cr>:!octave -qf %<cr>ddggdd:w<cr>
inoremap <buffer> <F5> <Esc> ggOpkg load all<esc>Gopause<esc>:w<cr>:!octave -qf %<cr>ddggdd:w<cr>