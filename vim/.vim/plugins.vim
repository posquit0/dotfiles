" plugins.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


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
    let g:startify_bookmarks=[
    \ '~/.vimrc',
    \ '~/.vim/plugins.vim',
    \]
    " A list of Vim regular expressions that filters recently used files
    let g:startify_skiplist=[
    \ 'COMMIT_EDITMSG',
    \ $VIMRUNTIME .'/doc',
    \ 'plugged/.*/doc',
    \ 'bundle/.*/doc',
    \]
  "" }}}

  "" Plugin: Gundo {{{
    " Make browsing Vim's powerful undo tree less painful
    Plug 'sjl/gundo.vim', { 'on': 'GundoToggle' }
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
    Plug 'scrooloose/nerdtree', { 'on': 'NERDTreeToggle' }
    " Map NERDTreeToggle to <F11>
    nnoremap <silent> <F11> :NERDTreeToggle<CR>
    " Ignore some extensions
    let NERDTreeIgnore=['.o$','.pyc$']
    " Show hidden files
    let NERDTreeShowHidden=1
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
    " Allow to see the concealed in the current cursor line when in normal & indent mode as intended
    let g:indentLine_noConcealCursor=""
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

  "" Plugin: EditorConfig {{{
    " EditorConfig plugin for Vim
    Plug 'editorconfig/editorconfig-vim'
    " Ensure that this plugin works well with Tim Pope's fugitive
    " Avoid loading EditorConfig for any remote files over ssh
    let g:EditorConfig_exclude_patterns = ['fugitive://.*', 'scp://.*']
  "" }}}

  "" Plugin: Syntastic {{{
    " Syntax checking for Vim with external syntax checker
    Plug 'scrooloose/syntastic'
    set statusline+=%#warningmsg#
    set statusline+=%{SyntasticStatuslineFlag()}
    set statusline+=%*
    let g:syntastic_always_populate_loc_list=1
    let g:syntastic_loc_list_height=5
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
    " For Javascript & Node.JS
    let g:syntastic_javascript_checkers = ['jshint']
  "" }}}

  "" Plugin: YouCompleteMe {{{
    " Code Completion Engine for Vim that is so fast, fuzzy-search
    " Clang based engine for C/C++/Object-C/Object-C++
    " Jedi based engine for Python
    " OmniSharp based engine for C#
    " Omnifunc based engine for other many languages
    function! BuildYCM(info)
      " info is a dictionary with 3 fields
      " - name:   name of the plugin
      " - status: 'installed', 'updated', or 'unchanged'
      " - force:  set on PlugInstall! or PlugUpdate!
      if a:info.status == 'installed' || a:info.force
        !./install.sh --clang-completer
      endif
    endfunction
    Plug 'Valloric/YouCompleteMe', { 'do': function('BuildYCM') }
    " Specifies a fallback path to a config file which is used 
    " if no '.ycm_extra_conf.py' is found
    let g:ycm_global_ycm_extra_conf="~/.vim/ycm_extra_conf.py"
    " Auto trigger for identifier completer and semantic completer
    let g:ycm_auto_trigger=1
    " Show the completion menu even when typing inside comments
    let g:ycm_complete_in_comments=0
    " Show the completion menu even when typing inside strings
    let g:ycm_complete_in_strings=0
    " The number of characters needs to type before identifier-based completion suggestions
    let g:ycm_min_num_of_chars_for_completion=3
    " Read identifiers from comments and strings
    let g:ycm_collect_identifiers_from_comments_and_strings=0
    " Read identifiers from my tags files (have to use Exuberant Ctags)
    let g:ycm_collect_identifiers_from_tags_files=1
    " Disable YCM's diagnostic functionality (Use Syntastic)
    let g:ycm_show_diagnostics_ui=0
    let g:ycm_enable_diagnostic_signs=0
    let g:ycm_enable_diagnostic_highlighting=0
    let g:ycm_echo_current_diagnostic=0
    let g:ycm_always_populate_location_list=0
    let g:ycm_open_loclist_on_ycm_diags=0
    " Auto-close preview window after completion
    let g:ycm_autoclose_preview_window_after_completion=1
    " Auto-close preview window after leaving inserting mode
    let g:ycm_autoclose_preview_window_after_insertion=1
    " Define where 'GoTo*' commands result should be opened
    " ['same-buffer', 'horizontal-split', 'vertical-split', 'new-tab']
    let g:ycm_goto_buffer_command='new-tab'
    " Define the max size(in Kb) for a file to be considered for completion
    let g:ycm_disable_for_files_larger_than_kb=1000
    " Determine for possible completions of snippet triggers
    let g:ycm_use_ultisnips_completer=0
    " Key mappings used to select the first completion string
    let g:ycm_key_list_select_completion=['<Down>']
    " Key mappings used to select the previous completion string
    let g:ycm_key_list_previous_completion=['<Up>']
    " Key mapping used to invoke the menu for semantic completion
    let g:ycm_key_invoke_completion='<C-Space>'
    " Key mapping used to show the full diagnostic
    let g:ycm_key_detailed_diagnostics=''
    " Controls the character-based triggers for the various language
    let g:ycm_semantic_triggers={
    \ 'c' : ['->', '.'],
    \ 'objc' : ['->', '.'],
    \ 'ocaml' : ['.', '#'],
    \ 'cpp,objcpp' : ['->', '.', '::'],
    \ 'perl' : ['->'],
    \ 'php' : ['->', '::'],
    \ 'cs,java,javascript,d,python,perl6,scala,vb,elixir,go' : ['.'],
    \ 'vim' : ['re![_a-zA-Z]+[_\w]*\.'],
    \ 'ruby' : ['.', '::'],
    \ 'lua' : ['.', ':'],
    \ 'erlang' : [':'],
    \}
  "" }}}

  "" Plugin: Vdebug {{{
    " Powerful debugger client for Vim using DBGP protocol
    " Tested with PHP, Python, Ruby, Perl, TCL and NodeJS
    Plug 'joonty/vdebug', { 'for': ['php', 'python', 'ruby', 'perl', 'javascript'] }
    let g:vdebug_keymap={
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
    let g:vdebug_options={
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
    let g:UltiSnipsListSnippets="<Tab>l"
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
    " Comment the whole lines in visual mode
    let g:NERDCommentWholeLinesInVMode=1
    " Add space after the left delimiter and before the right delimiter
    let g:NERDSpaceDelims=1
    " Remove spaces around comment delimiters
    let g:NERDRemoveExtraSpaces=1
  "" }}}

  "" Plugin: Auto Pairs {{{
    " For intensely orgasmic commenting
    Plug 'jiangmiao/auto-pairs'
    " Shortcut for fast wrapping the word
    let g:AutoPairsShortcutFastWrap="<C-e>"
    " Enable FlyMode
    let g:AutoPairsFlyMode=1
    " Insert the key at the Fly Mode jumped postion
    let g:AutoPairsShortcutBackInsert="<C-b>"
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
    let g:jedi#popup_on_dot=1
    " Automatically select the first entry upon starting completion
    let g:jedi#popup_select_first=0
    " Enable Jedi completions
    let g:jedi#completions_enabled=0
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
    Plug 'mattn/emmet-vim', { 
    \ 'for': [
    \   'html', 'haml', 'jinja', 'hbs', 'html.handlebars', 'xml',
    \   'css', 'less', 'sass'
    \ ]
    \}
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
    \ 'jinja': {
    \   'extends': 'html',
    \ },
    \ 'hbs': {
    \   'extends': 'html',
    \ },
    \ 'html.handlebars': {
    \   'extends': 'html',
    \ },
    \}
  "" }}}

  "" Plugin: Jinja {{{
    " Syntax file for vim with the ability to detect either HTML or Jinja
    Plug 'Glench/Vim-Jinja2-Syntax'
  "" }}}

  " Javascript & Node
  "" Plugin: Tern for Vim {{{
  " Tern-based Javascript editing support
  " Hook into omni completion to handle autocompletion and provide more
    function! BuildTern(info)
      " info is a dictionary with 3 fields
      " - name:   name of the plugin
      " - status: 'installed', 'updated', or 'unchanged'
      " - force:  set on PlugInstall! or PlugUpdate!
      if a:info.status == 'installed' || a:info.force
        !npm install
      endif
    endfunction
    Plug 'marijnh/tern_for_vim', { 'for': ['javascript'], 'do': function('BuildTern') }
    " Display argument type hints when the cursor is left over a function
    let g:tern_show_argument_hints="on_hold"
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
  "" }}}
  "" Theme: Seoul256 {{{
    Plug 'junegunn/seoul256.vim'
  "" }}}
  "" Theme: All-in-One {{{
    Plug 'flazz/vim-colorschemes'
  "" }}}
""" }}}
call plug#end()
