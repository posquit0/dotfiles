" general.vim
"
" Maintained by Claud D. Park <poqsuit0.bj@gmail.com>
" http://www.poqsuit0.com/


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
set clipboard+=unnamed
" Optimize for fast terminal connections
set ttyfast
" Walk directory tree upto $HOME looking for tags
set tags=./tags;$HOME
" Don’t add empty newlines at the end of files
set binary
set noeol
" Automatically change window's cwd to file's dir
set autochdir
set viminfo='100,n$HOME/.vim.info
"" Modeline
" Respect modeline in files
set modeline
set modelines=4

""" Auto Commands {{{
  " Auto reload vimrc
  if has("autocmd")
    augroup reload_vimrc
      autocmd!
      autocmd BufWritePost $MYVIMRC source $MYVIMRC
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
  " if exists("&undodir")
  "   set undodir=~/.vim/undo
  " endif
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
