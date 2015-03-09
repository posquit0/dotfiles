" plugins.vim
"
" Maintained by Claud D. Park <poqsuit0.bj@gmail.com>
" http://www.poqsuit0.com/


call plug#begin('~/.vim/plugged')

""" Vim Functionality {{{
  "" Plugin: L9 {{{
    " Provide some utility functions and commands for programming in Vim
    Plug 'L9'
  "" }}}

  "" Plugin: WebAPI Vim {{{
    " Provide interface for Web API
    " Dependency for Emmet-Vim Custom Snippet
    Plug 'mattn/webapi-vim'
  "" }}}
""" }}}

""" Integration {{{
  "" Plugin: Vim Git {{{
    " For syntax highlighting and other Git niceties
    Plug 'tpope/vim-git'
  "" }}}

  "" Plugin: Vim Fugitive {{{
    " The best Git wrapper
    Plug 'tpope/vim-fugitive'
    " Key mappings for convenience
    nnoremap <leader>gd :Gvdiff<CR>
    nnoremap <leader>gD :Gvdiff HEAD<CR>
    nnoremap <leader>gs :Gstatus<CR>:20wincmd +<CR>
    nnoremap <leader>gw :Gwrite<CR>
    nnoremap <leader>gb :Gblame -w<CR>:vertical resize 10<CR>
    nnoremap <leader>gci :Gcommit --verbose<CR>
  "" }}}

  "" Plugin: Sudo-Vim {{{
    " Sudo will ask for your password if need be
    " Usage: :e sudo:/etc/passwd
    Plug 'sudo.vim'
  "" }}}

  "" Plugin: Sherlock {{{
    " Add completion for command line mode ':' after a '/', and in command line mode '/' and '?'.
    " Using <C-Tab>, <C-S-Tab>
    Plug 'sherlock.vim'
  "" }}}

""" }}}

""" Interface {{{
  "" Plugin: Airline {{{
    " Use statusline more effective
    Plug 'bling/vim-airline'
    if has('gui_running')
      " Automatic population of the g:airline_symbols dictionary with
      " powerline symbols
      let g:airline_powerline_fonts=1
    endif
    " Specify theme for airline
    let g:airline_theme='sol'
    let g:airline#extensions#tabline#enabled=1
    let g:airline#extensions#tabline#left_sep=""
    let g:airline#extensions#tabline#left_alt_sep='|'
    let g:airline_section_b="%{strftime('%H:%M:%S')}"
    let g:airline_section_y="[%{&fileformat}/%{strlen(&fenc)?&fenc:&enc}]"
    " Use airline's showmode
    set noshowmode
  "" }}}

  "" Plugin: Vim Startify {{{
    " A fancy start screen for Vim
    Plug 'mhinz/vim-startify'
    " A list of files to bookmark
    let g:startify_bookmarks = [
    \ '~/.vimrc',
    \ '~/.vim/plugins.vim',
    \]
    " A list of Vim regular expressions that filters recently used files
    let g:startify_skiplist = [
    \ 'COMMIT_EDITMSG',
    \ $VIMRUNTIME .'/doc',
    \ 'plugged/.*/doc',
    \ 'bundle/.*/doc',
    \]
  "" }}}

  "" Plugin: Gundo {{{
    " Make browsing Vim's powerful undo tree less painful
    Plug 'sjl/gundo.vim'
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
  "" }}}

  "" Plugin: Tagbar {{{
    " Easy way to browse the tags
    Plug 'majutsushi/tagbar'
    " Map TagbarToggle to <F10>
    nnoremap <silent> <F10> :TagbarToggle<CR>
  "" }}}

  "" Plugin: NERD Tree {{{
    " Explore filesystem with Vim
    Plug 'scrooloose/nerdtree'
    " Map NERDTreeToggle to <F11>
    nnoremap <silent> <F11> :NERDTreeToggle<CR>
    " Ignore some extensions
    let NERDTreeIgnore=['.o$','.pyc$']
    " Automatically open NERDTree when vim start up with no files
    " autocmd StdinReadPre * let s:std_in=1
    " autocmd VimEnter * if argc() == 0 && !exists("s:std_in") | NERDTree | endif
    " Close vim if the only window left open is a NERDTree
    autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
  "" }}}

  "" Plugin: indentLine {{{
    " Displying thin vertical lines at each indentation level for code
    Plug 'Yggdroot/indentLine'
    " Change indentLine char
    " let g:indentLine_char='┆'
    let g:indentLine_char='|'
  "" }}}

  "" Plugin: CtrlP {{{
    " Full path fuzzy file, buffer, mru, tag finder for Vim
    Plug 'kien/ctrlp.vim'
    let g:ctrlp_map='<c-p>'
    let g:ctrlp_cmd='CtrlP'
  "" }}}
  
  "" Plugin: Easymotion {{{
    " Provides a much simpler way to use motions in Vim
    Plug 'Lokaltog/vim-easymotion'
  "" }}}

  "" Plugin: Vim Shell {{{
    " 
    Plug 'shougo/vimproc'
    Plug 'shougo/vimshell'
    " http://code.hootsuite.com/vimshell/
  "" }}}
""" }}}

""" Programming {{{
  "" Plugin: Vim Polyglot {{{
    " A collection of language packs for Vim
    Plug 'sheerun/vim-polyglot'
  "" }}}

  "" Plugin: Syntastic {{{
    " Syntax checking for Vim with external syntax checker
    Plug 'scrooloose/syntastic'
    set statusline+=%#warningmsg#
    set statusline+=%{SyntasticStatuslineFlag()}
    set statusline+=%*
    let g:syntastic_always_populate_loc_list=1
    let g:syntastic_auto_loc_list=1
    let g:syntastic_check_on_open=1
    let g:syntastic_check_on_wq=0
    " For C / C++
    let g:syntastic_cpp_compiler='clang++'
    let g:syntastic_cpp_compiler_options=' -std=c++11'
    " For Python
    let g:syntastic_python_checkers=['flake8']
    " For Scala & Java
    " let g:syntastic_scala_checkers=['fsc', 'scalac']
  "" }}}

  "" Plugin: Vdebug {{{
    " Powerful debugger client for Vim using DBGP protocol
    " Tested with PHP, Python, Ruby, Perl, TCL and NodeJS
    Plug 'joonty/vdebug', { 'for': ['php', 'python', 'ruby', 'perl'] }
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
  "" }}}

  "" Plugin: UltiSnips {{{
    " Snippet engine for Vim
    Plug 'SirVer/ultisnips'
    " Configure keys trigerring UltiSnips
    let g:UltiSnipsExpandTrigger="<Tab>"
    let g:UltiSnipsJumpForwardTrigger="<Tab>"
    let g:UltiSnipsJumpBackwardTrigger="<S-Tab>"
    let g:UltiSnipsListSnippets="<Tab><Tab>"
    " If you want :UltiSnipsEdit to split your window.
    let g:UltiSnipsEditSplit="vertical"
  "" }}}

  "" Plugin: Vim Snippets {{{
    " Snippets are separated from the engine (for UltiSnips)
    Plug 'honza/vim-snippets'
  "" }}}

  "" Plugin: Vim Surround {{{
    " All about surroundings: parenthless, brackets, quotes, XML tags, and more
    Plug 'tpope/vim-surround'
  "" }}}

  "" Plugin: Nerd Commenter {{{
    " For intensely orgasmic commenting
    Plug 'scrooloose/nerdcommenter'
  "" }}}

  "" Plugin: Auto Pairs {{{
    " For intensely orgasmic commenting
    Plug 'jiangmiao/auto-pairs'
  "" }}}

  " Python
  "" Plugin: Jedi-Vim {{{
    " Vim binding for the autocompletion library Jedi
    Plug 'davidhalter/jedi-vim', { 'for': 'python' }
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
  "" }}}

  "" Plugin: Vim Virtualenv {{{
    " Provide virtualenv's functions for Vim
    Plug 'jmcantrell/vim-virtualenv', { 'for': 'python' }
  "" }}}

  " HTML & CSS
  "" Plugin: Emmet {{{
    " Provide Zen-coding for Vim
    Plug 'mattn/emmet-vim'
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
  "" }}}
""" }}}

""" Themes {{{
  "" Theme: Molokai {{{
    Plug 'tomasr/molokai'
    " Match the original monokai background color
    let g:molokai_original=1
    " Bring the 256 color version
    let g:rehash256=1
  "" }}}
  "" Theme: Zenburn {{{
    Plug 'jnurmine/Zenburn'
  "" }}}
  "" Theme: Solarized {{{
    Plug 'altercation/vim-colors-solarized'
  ""}}}
  "" Theme: Seoul256 {{{
    Plug 'junegunn/seoul256.vim'
  "" }}}
  "" Theme: All-in-One {{{
    Plug 'flazz/vim-colorschemes'
  ""}}}
""" }}}
call plug#end()
