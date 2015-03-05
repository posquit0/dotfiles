" .vimrc
"
" Maintained by Claud D. Park <poqsuit0.bj@gmail.com>
" http://www.poqsuit0.com/

" Plugin list & config
source ~/.vim/plugins.vim
" General global configuration
source ~/.vim/global.vim

" GUI specific settings
if has('gui_running')
  source ~/.vim/gvim.vim
end