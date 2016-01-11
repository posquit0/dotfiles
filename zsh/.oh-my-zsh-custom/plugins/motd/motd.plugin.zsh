# vim:ft=zsh ts=2 sw=2 sts=2
#
# Welcome message for login shells
# Dependencies: random-quote
# 
# Posquit0's Welcome Message on ZSH
#
# Maintained by Claud D. Park <posquit0.bj@gmail.com>
# http://www.posquit0.com/

if [[ $SHLVL -eq 1 ]] ; then
  echo
  print -P "`quote`"
  echo
fi
