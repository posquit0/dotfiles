" plugins.after.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


""" Vim Functionality {{{
""" }}}

""" Integration {{{
""" }}}

""" Interface {{{
  "" Plugin: NERDTree {{{
    function! NERDTreeHighlightFile(extension, fg, bg, guifg, guibg)
      exec 'autocmd FileType nerdtree highlight ' . a:extension . ' ctermbg=' . a:bg . ' ctermfg=' . a:fg . ' guibg=' . a:guibg . ' guifg=' . a:guifg
      exec 'autocmd FileType nerdtree syn match ' . a:extension . ' #^\s\+.*' . a:extension . '$#'
    endfunction
    call NERDTreeHighlightFile('jade', 'green', 'none', 'green', 'NONE')
    call NERDTreeHighlightFile('ini', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('md', 'blue', 'none', '#3366FF', 'NONE')
    call NERDTreeHighlightFile('yml', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('config', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('conf', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('json', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('html', 'yellow', 'none', 'yellow', 'NONE')
    call NERDTreeHighlightFile('styl', 'cyan', 'none', 'cyan', 'NONE')
    call NERDTreeHighlightFile('css', 'cyan', 'none', 'cyan', 'NONE')
    call NERDTreeHighlightFile('coffee', 'Red', 'none', 'red', 'NONE')
    call NERDTreeHighlightFile('js', 'Red', 'none', '#ffa500', 'NONE')
    call NERDTreeHighlightFile('php', 'Magenta', 'none', '#ff00ff', 'NONE')
    call NERDTreeHighlightFile('ds_store', 'Gray', 'none', '#686868', 'NONE')
    call NERDTreeHighlightFile('gitconfig', 'Gray', 'none', '#686868', 'NONE')
    call NERDTreeHighlightFile('gitignore', 'Gray', 'none', '#686868', 'NONE')
    call NERDTreeHighlightFile('bashrc', 'Gray', 'none', '#686868', 'NONE')
    call NERDTreeHighlightFile('bashprofile', 'Gray', 'none', '#686868', 'NONE')
  "" }}}
""" }}}

""" Programming {{{
""" }}}

""" Themes {{{
""" }}}