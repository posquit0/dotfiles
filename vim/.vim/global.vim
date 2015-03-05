" global.vim
"
" Maintained by Claud D. Park <poqsuit0.bj@gmail.com>
" http://www.poqsuit0.com/

""" + General
" Make Vim more useful
set nocompatible
" Enhance command-line completion
set wildmenu
" Allow cursor keys in insert mode
set esckeys
" Number of things to remember in history
set history=256
" Time to wait after ESC (default causes an annoying delay)
set timeoutlen=250
" Use the OS clipboard by default (on versions compiled with `+clipboard`)
set clipboard+=unnamed
" Optimize for fast terminal connections
set ttyfast
" Enable mouse in all modes
set mouse=a
" Hide the mouse cursor while typing
set mousehide
" Map <leader> key
let mapleader=","
let g:mapleader=","
" Walk directory tree upto $HOME looking for tags
set tags=./tags;$HOME
" Don’t add empty newlines at the end of files
set binary
set noeol
" Automatically change window's cwd to file's dir
set autochdir
" Make Q meaningless (Q: Entering to Ex mode) 
nnoremap Q <nop>

"" Folding
" Trun on folding
set foldenable
" Make folding indent sensitive
set foldmethod=indent
" Don't autofold anything
set foldlevel=99
" Don't open folds when search into them
set foldopen-=search
" Don't open folds when undo stuff
set foldopen-=undo

"" Backup and swap
" Centralize backups, swapfiles and undo history
" set backupdir=~/.vim/backups
" set directory=~/.vim/swaps
" if exists("&undodir")
"   set undodir=~/.vim/undo
" endif
" Don’t create backups when editing files in certain directories
set backupskip=/tmp/*

"" Modeline
" Respect modeline in files
set modeline
set modelines=4

"" Match and search
" Highlight searches
set hlsearch
" Switching search-highlighting off until next search
nnoremap <silent> <Leader>/ :nohlsearch<CR>
" Ignore case of searches
set ignorecase
" be sensitive when there's a capital letter
set smartcase
" Highlight dynamically as pattern is typed
set incsearch 

"" Autoload
augroup reload_vimrc " {
  autocmd!
  autocmd BufWritePost $MYVIMRC source $MYVIMRC
augroup END " }
""" - General

""" + Encoding
set enc=utf-8
set fencs=utf-8,euc-kr
""" - Encoding

""" + Formatting
" Allow backspace in insert mode
set backspace=indent,eol,start

" Set the default tabstop
set tabstop=2
set softtabstop=2
" Set the default shift width for indents
set shiftwidth=2
" Make tabs into spaces (set by tabstop)
set expandtab
" Smarter tab levels
set smarttab
""" - Formatting

""" + Visual
" Enable 256 colors in vim
set t_Co=256
" Line numbers on
set number
" Show the command typing
set showcmd
" Show matching brackets
set showmatch
" Bracket blinking
set matchtime=5
" No blinking
set novisualbell
" No noise
set noerrorbells
" Always show status line.
set laststatus=2
" Show ruler
set ruler
" Show the current mode
set showmode
" Enable syntax highlighting
syntax on
" Highlight current line 
set cursorline
""" - Visual

""" + Hex Editor
" Map HexEditToggle to <F9>
nnoremap <silent> <F9> :call HexEditToggle()<CR>
let g:hexmode=0
function! HexEditToggle()
  if g:hexmode
    let g:hexmode=0
    %!xxd -r
  else
    let g:hexmode=1
    %!xxd
  endif
endfunction
""" - Hex Editor

""" + Windows
nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-l> <C-w>l
""" - Windows

""" + Tabs
nnoremap <silent> <Tab><Tab> :tabnew<CR>
nnoremap <silent> <Tab>q :tabclose<CR>
nnoremap <silent> <Tab>o :tabonly<CR>
nnoremap <silent> <Tab>s :tabs<CR>
nnoremap <silent> <Tab>f :tabfirst<CR>
nnoremap <silent> <Tab>l :tablast<CR>
nnoremap <silent> <Tab>n :tabnext<CR>
nnoremap <silent> <Tab>p :tabprevious<CR>
nnoremap <silent> <Tab><Right> :tabnext<CR>
nnoremap <silent> <Tab><Left> :tabprevious<CR>
nnoremap <silent> <Tab>1 :tabnext 1<CR>
nnoremap <silent> <Tab>2 :tabnext 2<CR>
nnoremap <silent> <Tab>3 :tabnext 3<CR>
nnoremap <silent> <Tab>4 :tabnext 4<CR>
nnoremap <silent> <Tab>5 :tabnext 5<CR>
nnoremap <silent> <Tab>6 :tabnext 6<CR>
nnoremap <silent> <Tab>7 :tabnext 7<CR>
nnoremap <silent> <Tab>8 :tabnext 8<CR>
nnoremap <silent> <Tab>9 :tabnext 9<CR>
""" - Tabs

""" + Themes
colorscheme molokai
""" - Themes
