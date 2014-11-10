" .vimrc
"
" maintained by Posquit0.BJ <poqsuit0.bj@gmail.com>
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
let mapleader = ","
let g:mapleader = ","
" Walk directory tree upto $HOME looking for tags
set tags=./tags;$HOME
" Don’t add empty newlines at the end of files
set binary
set noeol

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
" Ignore case of searches
set ignorecase
" be sensitive when there's a capital letter
set smartcase
" Highlight dynamically as pattern is typed
set incsearch 
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
nnoremap <silent> <F5> :%!xxd<CR>
nnoremap <silent> <F6> :%!xxd -r<CR>
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

filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'gmarik/Vundle.vim'

" The following are examples of different formats supported.
" Keep Plugin commands between vundle#begin/end.
" plugin on GitHub repo
Plugin 'tpope/vim-fugitive'
" plugin from http://vim-scripts.org/vim/scripts.html
" Plugin 'L9'
" Git plugin not hosted on GitHub
" Plugin 'git://git.wincent.com/command-t.git'
" git repos on your local machine (i.e. when working on your own plugin)
" Plugin 'file:///home/gmarik/path/to/plugin'
" The sparkup vim script is in a subdirectory of this repo called vim.
" Pass the path to set the runtimepath properly.
" Plugin 'rstacruz/sparkup', {'rtp': 'vim/'}
" Avoid a name conflict with L9
" Plugin 'user/L9', {'name': 'newL9'}

" Scala
Plugin 'derekwyatt/vim-scala'

""" + Plugin: Sherlock
" Add completion for command line mode ':' after a '/', and in command line mode '/' and '?'.
" Using <C-Tab>, <C-S-Tab>
Bundle 'sherlock.vim'
""" - Plugin: Sherlock

""" + Plugin: Airline
" Use statusline more effective
Plugin 'bling/vim-airline'
let g:airline_powerline_fonts=1
let g:airline_theme='powerlineish'
let g:airline#extensions#tabline#enabled = 1
let g:airline#extensions#tabline#left_sep = ""
let g:airline#extensions#tabline#left_alt_sep = '|'
let g:airline_section_b="%{strftime('%H:%M:%S')}"
let g:airline_section_y="[%{&fileformat}/%{strlen(&fenc)?&fenc:&enc}]"
" Use airline's showmode
set noshowmode
""" - Plugin: Airline

" All of your Plugins must be added before the following line
call vundle#end()            " required
filetype plugin indent on    " required
" To ignore plugin indent changes, instead use:
"filetype plugin on
"
" Brief help
" :PluginList       - lists configured plugins
" :PluginInstall    - installs plugins; append `!` to update or just :PluginUpdate
" :PluginSearch foo - searches for foo; append `!` to refresh local cache
" :PluginClean      - confirms removal of unused plugins; append `!` to auto-approve removal
"
" see :h vundle for more details or wiki for FAQ
" Put your non-Plugin stuff after this line
"

