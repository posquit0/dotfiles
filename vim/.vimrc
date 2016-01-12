" .vimrc
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/

""" General Configuration (excepting visual.vim)
source \~/.vim/general.vim
source \~/.vim/key-mapping.vim

""" Plugin Configuration
" All the vim plugins are managed by 'vim-plug'
" List & configuration of plugins separated to a file 'plugins.vim'
" It makes this vimrc could also work out-of-box even if not managed by
" dotfiles.
if filereadable(expand("\~/.vim/plugins.vim"))
  source \~/.vim/plugins.vim
endif

""" General Configuration - Visual
source \~/.vim/visual.vim


""" Override Configuration (because of plugins.vim)
source \~/.vim/override.vim

""" GUI Specific Configuration
if has('gui_running')
  source \~/.vim/gvim.vim
endif

""" Local Specific Configuration
" Use local vimrc if available
if filereadable(expand("\~/.vimrc.local"))
  source \~/.vimrc.local
endif