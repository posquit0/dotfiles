" override.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


" Octave syntax
augroup filetypedetect
  au! BufRead,BufNewFile *.m,*.oct set filetype=octave
augroup END 
