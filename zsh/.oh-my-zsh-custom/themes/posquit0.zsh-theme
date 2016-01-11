# vim:ft=zsh ts=2 sw=2 sts=2
#
# It is recommended to use with a dark background and the font Inconsolata.
# Colors: black, red, green, yellow, *blue, magenta, cyan, and white.
# 
# Posquit0's Zsh Theme
#
# Maintained by Claud D. Park <posquit0.bj@gmail.com>
# http://www.posquit0.com/


### Functionalities {{{
  ## Colorize {{
    # Takes two arguments, background and foreground. Both can be omitted,
    # rendering default background/foreground.
    function _prompt_colorize() {
      local bg_color fg_color
      [[ -n $1 ]] && bg_color="%{$bg[$1]%}"
      if [[ $3 == 'bold' ]]; then
        [[ -n $2 ]] && fg_color="%{$terminfo[bold]$fg[$2]%}"
      else
        [[ -n $2 ]] && fg_color="%{$fg[$2]%}"
      fi
      echo -n "$bg_color$fg_color"
      [[ -n $4 ]] && echo -n $4
      echo -n "%{$reset_color%}"
    }
  ## }
### }}}


### Components {{{
  ## Virtualenv {{
  ## Show current working python virtualenv information
    # Disable default prompt provided by virtualenv
    export VIRTUAL_ENV_DISABLE_PROMPT=1
    # Set prefix/suffix for virtualenv's prompt
    ZSH_THEME_VIRTUAL_ENV_PROMPT_PREFIX="("
    ZSH_THEME_VIRTUAL_ENV_PROMPT_SUFFIX=")"
    # Function to construct virtualenv's prompt
    function _prompt_virtualenv() {
      if [ -n "$VIRTUAL_ENV" ]; then
        if [ -f "$VIRTUAL_ENV/__name__" ]; then
          local name=`cat $VIRTUAL_ENV/__name__`
        elif [ `basename $VIRTUAL_ENV` = "__" ]; then
          local name=$(basename $(dirname $VIRTUAL_ENV))
        else
          local name=$(basename $VIRTUAL_ENV)
        fi
        _prompt_colorize "" yellow bold "$ZSH_THEME_VIRTUAL_ENV_PROMPT_PREFIX$name$ZSH_THEME_VIRTUAL_ENV_PROMPT_SUFFIX"
      fi
    }
  ## }}
  ## Git {{
  ## Show current working git repository information
    function _prompt_git() {
      ZSH_THEME_GIT_PROMPT_PREFIX="%{$fg[green]%}["
      ZSH_THEME_GIT_PROMPT_SUFFIX="]%{$reset_color%}"
      ZSH_THEME_GIT_PROMPT_CLEAN="%{$fg[green]%} ✔%{$fg[green]%}"
      ZSH_THEME_GIT_PROMPT_DIRTY="%{$fg[red]%} ✘%{$fg[green]%}"
      ZSH_THEME_GIT_PROMPT_ADDED="%{$fg[yellow]%} ✚%{$fg[green]%}"
      ZSH_THEME_GIT_PROMPT_MODIFIED="%{$fg[yellow]%} ✹%{$fg[green]%}"
      _prompt_colorize "" green "" "$(git_prompt_info)"
    }
  ## }}
  ## Username {{
  ## Show current username(highlight if user is root)
    function _prompt_username() {
      local user_name="%n"
      if [[ $UID -eq 0 ]]; then
        _prompt_colorize white red bold "$user_name"
      else
        _prompt_colorize "" cyan "" "$user_name"
      fi
    }
  ## }}
  ## Directory {{
  ## Show current working directory information
    function _prompt_dir() {
      local current_dir="${PWD/#$HOME/~}"
      _prompt_colorize "" yellow bold "$current_dir"
    }
  ## }}
  ## Time {{
  ## Show current time
    # Set prefix/suffix for time
    ZSH_THEME_TIME_PROMPT_PREFIX=""
    ZSH_THEME_TIME_PROMPT_POSTFIX=""
    ZSH_THEME_TIME_PROMPT_ENABLE_EMOJI="true"
    function _prompt_time() {
      # To make a emoji for clock
      # Add 15 minutes to the current time and save the value as $minutes.
      (( minutes = $(date '+%M') + 15 ))
      (( hour = $(date '+%I') + minutes / 60 ))
      # Make sure minutes and hours don't exceed 60 nor 12 respectively
      (( minutes %= 60 )); (( hour %= 12 ))
      case $hour in
        0) emoji_clock="🕛"; [ $minutes -ge 30 ] && emoji_clock="🕧";;
        1) emoji_clock="🕐"; [ $minutes -ge 30 ] && emoji_clock="🕜";;
        2) emoji_clock="🕑"; [ $minutes -ge 30 ] && emoji_clock="🕝";;
        3) emoji_clock="🕒"; [ $minutes -ge 30 ] && emoji_clock="🕞";;
        4) emoji_clock="🕓"; [ $minutes -ge 30 ] && emoji_clock="🕟";;
        5) emoji_clock="🕔"; [ $minutes -ge 30 ] && emoji_clock="🕠";;
        6) emoji_clock="🕕"; [ $minutes -ge 30 ] && emoji_clock="🕡";;
        7) emoji_clock="🕖"; [ $minutes -ge 30 ] && emoji_clock="🕢";;
        8) emoji_clock="🕗"; [ $minutes -ge 30 ] && emoji_clock="🕣";;
        9) emoji_clock="🕘"; [ $minutes -ge 30 ] && emoji_clock="🕤";;
        10) emoji_clock="🕙"; [ $minutes -ge 30 ] && emoji_clock="🕥";;
        11) emoji_clock="🕚"; [ $minutes -ge 30 ] && emoji_clock="🕦";;
        *) emoji_clock="⌛";;
      esac
      local current_time="%*"
      if [ "$ZSH_THEME_TIME_PROMPT_ENABLE_EMOJI" != "true" ]; then
        _prompt_colorize "" white "" "$ZSH_THEME_TIME_PROMPT_PREFIX$current_time$ZSH_THEME_TIME_PROMPT_POSTFIX"
      else
        _prompt_colorize "" white "" "$emoji_clock $ZSH_THEME_TIME_PROMPT_PREFIX$current_time$ZSH_THEME_TIME_PROMPT_POSTFIX"
      fi
    }
  ## }}
  ## Machine {{
  ## Show machine's name(default: hostname)
    function _prompt_machine() {
      local machine_name="$HOST"
      _prompt_colorize "" green "" "$machine_name"
    }
  ## }}
  ## Prompt Sign {{
  ## Show prompt's sign(default: $)
    function _prompt_sign() {
      ZSH_THEME_PROMPT_SIGN="$"
      _prompt_colorize "" red bold "$ZSH_THEME_PROMPT_SIGN "
    }
  ## }}
### }}}

### Main Prompt {{{
  ## 1st Line {{
    function _prompt_1st_line() {
      RETVAL=$?
      _prompt_colorize "" blue bold "# "
      _prompt_username
      _prompt_colorize "" white "" " at "
      _prompt_machine
      _prompt_colorize "" white "" " in "
      _prompt_dir
      _prompt_colorize "" white "" " "
      _prompt_git
      _prompt_colorize "" white "" " "
      _prompt_time
    }
  ## }}
  ## 2nd Line {{
    function _prompt_2nd_line() {
      RETVAL=$?
      _prompt_virtualenv
      _prompt_sign
    }
  ## }}
  ## Main prompt {{
  ## Prompt format: \n # USER at MACHINE in DIRECTORY on git:BRANCH STATE [TIME] \n $ 
    PROMPT='$(_prompt_1st_line)'
    PROMPT+=$'\n'
    PROMPT+='$(_prompt_2nd_line)'
  ## }}
### }}}
