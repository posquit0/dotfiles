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
let mapleader=","
let g:mapleader=","
" Walk directory tree upto $HOME looking for tags
set tags=./tags;$HOME
" Don’t add empty newlines at the end of files
set binary
set noeol
" automatically change window's cwd to file's dir
set autochdir

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
" plugin from http://vim-scripts.org/vim/scripts.html
" Git plugin not hosted on GitHub
" Plugin 'git://git.wincent.com/command-t.git'
" git repos on your local machine (i.e. when working on your own plugin)
" Plugin 'file:///home/gmarik/path/to/plugin'
" The sparkup vim script is in a subdirectory of this repo called vim.
" Pass the path to set the runtimepath properly.
" Plugin 'rstacruz/sparkup', {'rtp': 'vim/'}
" Avoid a name conflict with L9
" Plugin 'user/L9', {'name': 'newL9'}

""" + Plugin: L9
" Provide some utility functions and commands for programming in Vim
Plugin 'L9'
""" - Plugin: L9

""" + Plugin: WebAPI Vim
" Provide interface for Web API
" Dependency for Emmet-Vim Custom Snippet
Plugin 'mattn/webapi-vim'
""" - Plugin: WebAPI Vim

""" + Plugin: Vim Git
" For syntax highlighting and other Git niceties
Plugin 'tpope/vim-git'
""" - Plugin: Vim Git

""" + Plugin: Vim Fugitive
" The best Git wrapper
Plugin 'tpope/vim-fugitive'
""" - Plugin: Vim Fugitive

""" + Plugin: Gundo
" Make browsing Vim's powerful undo tree less painful
Plugin 'sjl/gundo.vim'
" Map GundoToggle to <F12>
nnoremap <silent> <F12> :GundoToggle<CR>
" Set the horizontal width of Gundo graph
let g:gundo_width=40
" Force the preview window below current windows
let g:gundo_preview_bottom=1
" Set 1 to open the right side instead of the left
let g:gundo_right=0
" Disable Gundo entirely if machine not support python
if v:version < '703' || !has('python')
  let g:gundo_disable=1
endif
" Rendering diff automatically with cursor move
let g:gundo_auto_preview=1
""" - Plugin: Gundo

""" + Plugin: Tagbar
" Easy way to browse the tags
Plugin 'majutsushi/tagbar'
" Map TagbarToggle to <F10>
nnoremap <silent> <F10> :TagbarToggle<CR>
""" - Plugin: Tagbar

""" + Plugin: NERD Tree
" Explore filesystem with Vim
Plugin 'scrooloose/nerdtree'
" Map NERDTreeToggle to <F11>
nnoremap <silent> <F11> :NERDTreeToggle<CR>
" Ignore some extensions
let NERDTreeIgnore=['.o$','.pyc$']
" Automatically open NERDTree when vim start up with no files
autocmd StdinReadPre * let s:std_in=1
autocmd VimEnter * if argc() == 0 && !exists("s:std_in") | NERDTree | endif
" Close vim if the only window left open is a NERDTree
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
""" - Plugin: NERD Tree

""" + Plugin: CtrlP
" Full path fuzzy file, buffer, mru, tag finder for Vim
Plugin 'kien/ctrlp.vim'
let g:ctrlp_map='<c-p>'
let g:ctrlp_cmd='CtrlP'
""" - Plugin: CtrlP

""" + Plugin: Sudo-Vim
" Sudo will ask for your password if need be
" Usage: :e sudo:/etc/passwd
Plugin 'sudo.vim'
""" - Plugin: Sudo-Vim

""" + Plugin: Vim Shell
" 
Plugin 'shougo/vimproc'
Plugin 'shougo/vimshell'
" http://code.hootsuite.com/vimshell/
""" - Plugin: Vim Shell

""" + Plugin: Sherlock
" Add completion for command line mode ':' after a '/', and in command line mode '/' and '?'.
" Using <C-Tab>, <C-S-Tab>
Plugin 'sherlock.vim'
""" - Plugin: Sherlock

""" + Plugin: Airline
" Use statusline more effective
Plugin 'bling/vim-airline'
" let g:airline_powerline_fonts=1
let g:airline_theme='sol'
let g:airline#extensions#tabline#enabled=1
let g:airline#extensions#tabline#left_sep=""
let g:airline#extensions#tabline#left_alt_sep='|'
let g:airline_section_b="%{strftime('%H:%M:%S')}"
let g:airline_section_y="[%{&fileformat}/%{strlen(&fenc)?&fenc:&enc}]"
" Use airline's showmode
set noshowmode
""" - Plugin: Airline

""" + Plugin: indentLine
" Displying thin vertical lines at each indentation level for code
Plugin 'Yggdroot/indentLine'
" Change indentLine char
let g:indentLine_char='┆'
""" - Plugin: indentLine

""" + Plugin: Easymotion
" Provides a much simpler way to use motions in Vim
Plugin 'Lokaltog/vim-easymotion'
""" - Plugin: Easymotion

" General
""" + Plugin: Vim Polyglot
" A collection of language packs for Vim
Plugin 'sheerun/vim-polyglot'
""" - Plugin: Vim Polyglot

""" + Plugin: Syntastic
" Syntax checking for Vim with external syntax checker
Plugin 'scrooloose/syntastic'
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*
let g:syntastic_always_populate_loc_list=1
let g:syntastic_auto_loc_list=1
let g:syntastic_check_on_open=1
let g:syntastic_check_on_wq=0
let g:syntastic_python_checkers = ['flake8']
" let g:syntastic_scala_checkers=['fsc', 'scalac']
""" - Plugin: Syntastic

""" + Plugin: Vdebug
" Powerful debugger client for Vim using DBGP protocol
" Tested with PHP, Python, Ruby, Perl, TCL and NodeJS
Plugin 'joonty/vdebug'
let g:vdebug_keymap = {
\ "run": "<F5>",
\ "run_to_cursor": "<F6>",
\ "step_over": "<F2>",
\ "step_into": "<F3>",
\ "step_out": "<F4>",
\ "close": "<F7>",
\ "detach": "<F8>",
\ "set_breakpoint": "<Leader>b",
\ "eval_visual": "<Leader>e"
\}
let g:vdebug_options = {
\ "port": 9000,
\ "server": 'localhost',
\ "timeout": 20,
\ "on_close": 'detach',
\ "break_on_open": 0,
\ "ide_key": '',
\ "path_maps": {},
\ "debug_window_level": 0,
\ "debug_file_level": 1,
\ "debug_file": "/tmp/vdebug.log",
\ "watch_window_style": 'expanded',
\ "marker_default": '*',
\ "marker_closed_tree": '▸',
\ "marker_open_tree": '▾'
\}
""" - Plugin: Vdebug

""" + Plugin: UltiSnips
" Snippet engine for Vim
Plugin 'SirVer/ultisnips'
" Configure keys trigerring UltiSnips
let g:UltiSnipsExpandTrigger="<Tab>"
let g:UltiSnipsJumpForwardTrigger="<Tab>"
let g:UltiSnipsJumpBackwardTrigger="<S-Tab>"
let g:UltiSnipsListSnippets="<Tab><Tab>"
" If you want :UltiSnipsEdit to split your window.
let g:UltiSnipsEditSplit="vertical"
""" - Plugin: UltiSnips

""" + Plugin: Vim Snippets
" Snippets are separated from the engine (for UltiSnips)
Plugin 'honza/vim-snippets'
""" - Plugin: Vim Snippets

" Scala
" Plugin 'derekwyatt/vim-scala'

" Python
""" + Plugin: Jedi-Vim
" Vim binding for the autocompletion library Jedi
Plugin 'davidhalter/jedi-vim'
" Enable the default initialization routine
let g:jedi#auto_initialization=1
" Disable the default vim configuration
let g:jedi#auto_vim_configuration=0
" Show the function call signature window during writing arugments
let g:jedi#show_call_signatures=1
" Disable automatically starts completion upon typing
let g:jedi#popup_on_dot=0
" Automatically select the first entry upon starting completion
let g:jedi#popup_select_first=0
" Enable Jedi completions
let g:jedi#completions_enabled=1
" Open a new tab if use the go to
let g:jedi#use_tabs_not_buffers=1
" Don't want the docstring window to popup during compeletion
autocmd FileType python setlocal completeopt-=preview
" Key Bindings for Jedi-Vim
let g:jedi#goto_assignments_command="<leader>g"
let g:jedi#goto_definitions_command="<leader>d"
let g:jedi#documentation_command="K"
let g:jedi#usages_command="<leader>n"
let g:jedi#completions_command="<C-Space>"
let g:jedi#rename_command="<leader>r"
""" - Plugin: Jedi-Vim

""" + Plugin: Vim Virtualenv
" Provide virtualenv's functions for Vim
Plugin 'jmcantrell/vim-virtualenv'
""" - Plugin: Vim Virtualenv

" HTML & CSS
""" + Plugin: Emmet
" Provide Zen-coding for Vim
Plugin 'mattn/emmet-vim'
" Enable all functions, which is equal to
" n: normal, i: insert: v: visual, a: all
let g:user_emmet_mode='i'
" Remap the default Emmet leader key <C-Y>
let g:user_emmet_leader_key='<C-Y>'
" Customize the behavior of the languages
let g:user_emmet_settings={
\ 'xml': {
\   'extends': 'html',
\ },
\ 'haml': {
\   'extends': 'html',
\ },
\}
""" - Plugin: Emmet

" Themes
" Plugin 'flazz/vim-colorschemes'
Plugin 'jnurmine/Zenburn'
Plugin 'tomasr/molokai'
" Match the original monokai background color
let g:molokai_original=1
" Bring the 256 color version
let g:rehash256=1

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

""" + Themes
colorscheme molokai
""" - Themes