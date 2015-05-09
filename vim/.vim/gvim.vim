" gvim.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


" GUI configuration for each OS
if has("unix")
  let s:uname=substitute(system("uname -s"), '\n', '', '')
endif

if has("gui_win32")

elseif has("gui_gtk2")

elseif has("unix") && s:uname == "Darwin"

endif

