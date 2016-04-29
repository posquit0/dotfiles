" general.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


" Make Vim more useful
set nocompatible
" Use path '~/.vim' even on non-unix machine
set runtimepath+=~/.vim
" Enhance command-line completion
set wildmenu
" Ignore when expanding wildcards
set wildignore=*.swp,*.swo,*.class
" Number of things to remember in history
set history=256
" Use the OS clipboard by default (on versions compiled with `+clipboard`)
set clipboard=unnamed
" Optimize for fast terminal connections
set ttyfast
" Walk directory tree upto $HOME looking for tags
set tags=./tags;$HOME
" Don’t add empty newlines at the end of files
set binary
set noeol
" Automatically change window's cwd to file's dir
set autochdir
set viminfo='100,n$HOME/.viminfo
" Set default shell to execute functions
set shell=sh
"" Modeline
" Respect modeline in files
set modeline
set modelines=4

""" Auto Commands {{{
  if has("autocmd")
    " Auto reload vimrc
    " augroup reload_vimrc
    "   autocmd!
    "   autocmd BufWritePost $MYVIMRC,*.vim
    "     \ source $MYVIMRC |
    "     \ echo "Reloaded VIM Configurations"
    " augroup END
    " Restore cursor position when opening file
    augroup restore_cursor
      autocmd!
      autocmd BufReadPost *
        \ if line("'\"") > 1 && line("'\"") <= line("$") |
        \   exe "normal! g`\"" |
        \ endif
    augroup END
  endif
""" }}}

""" Folding {{{
  " Turn on folding
  set foldenable
  " Make folding indent sensitive
  set foldmethod=indent
  " Don't autofold anything
  set foldlevel=99
  " Don't open folds when search into them
  set foldopen-=search
  " Don't open folds when undo stuff
  set foldopen-=undo
""" }}}

""" Backup & Swap {{{
  " No fucking backup & swap files
  set noswapfile
  set nobackup
  " Centralize backups, swapfiles and undo history
  " set backupdir=~/.vim/backups
  " set directory=~/.vim/swaps
  " Maintain undo history between sessions
  set undofile
  " Set maximum number of changes that can be undone
  set undolevels=100
  " Change directory to save undo history
  if has('persistent_undo')
    set undodir=~/.vim/cache
    if isdirectory(&undodir)==0
      " Create directory
      call system('mkdir ' . &undodir)
    endif
  endif
  " Don’t create backups when editing files in certain directories
  set backupskip=/tmp/*
""" }}}

""" Encoding {{{
  set encoding=utf-8
  set fileencodings=utf-8,euc-kr
""" }}}

""" Formatting {{{
  " Set the default tabstop
  set tabstop=2
  set softtabstop=2
  " Set the default shift width for indents
  set shiftwidth=2
  " Make tabs into spaces (set by tabstop)
  set expandtab
  " Smarter tab levels
  set smarttab
  " Copy indent from current line when starting a new line
  set autoindent
  " Do smart autoindenting when starting a new line
  set smartindent
""" }}}