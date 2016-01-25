" gvim.vim
"
" Maintained by Claud D. Park <posquit0.bj@gmail.com>
" http://www.posquit0.com/


" GUI configuration for each OS

if has("unix")
""" Unix & Linux {{{
  let s:uname=substitute(system("uname -s"), '\n', '', '')
  set guifont=DejaVu\ Sans\ Mono\ for\ Powerline\ 11
""" }}}

elseif has("gui_win32")
""" Window {{{

""" }}}

elseif has("gui_gtk2")
""" GTK32 {{{
""" }}}

elseif has("unix") && s:uname == "Darwin"
""" OS X {{{
  set guifont=DejaVu\ Sans\ Mono\ for\ Powerline:h11
""" }}}
endif