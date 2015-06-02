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
    function prompt_colorize() {
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
    function prompt_virtualenv() {
      if [ -n "$VIRTUAL_ENV" ]; then
        if [ -f "$VIRTUAL_ENV/__name__" ]; then
          local name=`cat $VIRTUAL_ENV/__name__`
        elif [ `basename $VIRTUAL_ENV` = "__" ]; then
          local name=$(basename $(dirname $VIRTUAL_ENV))
        else
          local name=$(basename $VIRTUAL_ENV)
        fi
        prompt_colorize "" yellow bold "$ZSH_THEME_VIRTUAL_ENV_PROMPT_PREFIX$name$ZSH_THEME_VIRTUAL_ENV_PROMPT_SUFFIX"
      fi
    }
  ## }}
  ## Git {{
  ## Show current working git repository information
    function prompt_git() {
      ZSH_THEME_GIT_PROMPT_PREFIX="%{$fg[green]%}["
      ZSH_THEME_GIT_PROMPT_SUFFIX="]%{$reset_color%}"
      ZSH_THEME_GIT_PROMPT_DIRTY=" %{$fg[red]%}*%{$fg[green]%}"
      ZSH_THEME_GIT_PROMPT_CLEAN=""
      prompt_colorize "" green "" "$(git_prompt_info)"
    }
  ## }}
  ## Username {{
  ## Show current username(highlight if user is root)
    function prompt_username() {
      local user_name="%n"
      if [[ $UID -eq 0 ]]; then
        prompt_colorize white red bold "$user_name"
      else
        prompt_colorize "" cyan "" "$user_name"
      fi
    }
  ## }}
  ## Directory {{
  ## Show current working directory information
    function prompt_dir() {
      local current_dir="${PWD/#$HOME/~}"
      prompt_colorize "" yellow bold "$current_dir"
    }
  ## }}
  ## Time {{
  ## Show current time
    # Set prefix/suffix for time
    ZSH_THEME_TIME_PROMPT_PREFIX="["
    ZSH_THEME_TIME_PROMPT_POSTFIX="]"
    function prompt_time() {
      local current_time="%*"
      prompt_colorize "" white "" "$ZSH_THEME_TIME_PROMPT_PREFIX$current_time$ZSH_THEME_TIME_PROMPT_POSTFIX"
    }
  ## }}
  ## Machine {{
  ## Show machine's name(default: hostname)
    function prompt_machine() {
      local machine_name="$HOST"
      prompt_colorize "" green "" "$machine_name"
    }
  ## }}
  ## Prompt Sign {{
  ## Show prompt's sign(default: $)
    function prompt_sign() {
      ZSH_THEME_PROMPT_SIGN="$"
      prompt_colorize "" red bold "$ZSH_THEME_PROMPT_SIGN "
    }
  ## }}
### }}}

### Main Prompt {{{
  ## 1st Line {{
    function prompt_1st_line() {
      RETVAL=$?
      prompt_colorize "" blue bold "# "
      prompt_username
      prompt_colorize "" white "" " at "
      prompt_machine
      prompt_colorize "" white "" " in "
      prompt_dir
      prompt_colorize "" white "" " "
      prompt_git
      prompt_colorize "" white "" " "
      prompt_time
    }
  ## }}
  ## 2nd Line {{
    function prompt_2nd_line() {
      RETVAL=$?
      prompt_virtualenv
      prompt_sign
    }
  ## }}
  ## Main prompt {{
  ## Prompt format: \n # USER at MACHINE in DIRECTORY on git:BRANCH STATE [TIME] \n $ 
    PROMPT='$(prompt_1st_line)'
    PROMPT+=$'\n'
    PROMPT+='$(prompt_2nd_line)'
  ## }}
### }}}
