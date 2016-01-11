# vim:ft=zsh ts=2 sw=2 sts=2
#
# Welcome message for login shells
# Dependencies: random-quote
# 
# Posquit0's Welcome Message on ZSH
#
# Maintained by Claud D. Park <posquit0.bj@gmail.com>
# http://www.posquit0.com/

      ZSH_THEME_GIT_PROMPT_PREFIX=
      ZSH_THEME_GIT_PROMPT_SUFFIX=
if [[ $SHLVL -eq 1 ]] ; then
  echo "$fg[green]"
  cat $(dirname -- $0)/motd
	echo "$reset_color"
  print -P "`quote`"
  echo
fi
