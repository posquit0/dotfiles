" .vimrc
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/

""" General Configuration (excepting visual.vim)
if filereadable(expand("\~/.vim/general.vim"))
  source \~/.vim/general.vim
endif
if filereadable(expand("\~/.vim/key-mapping.vim"))
  source \~/.vim/key-mapping.vim
endif


""" Plugin Configuration
" All the vim plugins are managed by 'vim-plug'
" List & configuration of plugins separated to two file 'plugins.vim',
" 'plugins.after.vim'.
" It makes this vimrc could also work out-of-box even if not managed by
" dotfiles.
if filereadable(expand("\~/.vim/plugins.vim"))
  source \~/.vim/plugins.vim
endif

""" General Configuration - Visual
if filereadable(expand("\~/.vim/visual.vim"))
  source \~/.vim/visual.vim
endif

""" Plugin Configuration after loading plug
if filereadable(expand("\~/.vim/plugins.after.vim"))
  source \~/.vim/plugins.after.vim
endif

""" Override Configuration (because of plugins.vim)
if filereadable(expand("\~/.vim/override.vim"))
  source \~/.vim/override.vim
endif

""" GUI Specific Configuration
if has('gui_running')
  if filereadable(expand("\~/.vim/gvim.vim"))
    source \~/.vim/gvim.vim
  endif
endif

""" Local Specific Configuration
" Use local vimrc if available
if filereadable(expand("\~/.vimrc.local"))
  source \~/.vimrc.local
endif