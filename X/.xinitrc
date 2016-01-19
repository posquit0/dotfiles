#!/usr/bin/env bash
# .xinitrc
#
# Maintained by Claud D. Park <posquit0.bj@gmail.com>
# http://www.posquit0.com/


### Miscellaneous {{{
  # Print a message for an information
  function print_info() {
    echo -ne "\033[1;32m"
    echo -n "$@"
    echo -e "\033[m"
  }
  # Print a message for an error
  function print_error() {
    echo -ne "\033[1;31m"
    echo -n "$@"
    echo -e "\033[m"
  }
### }}}

Xmodmap() {
  if [ -f "${HOME}/.Xmodmap" -a -x "$(which xmodmap)" ]; then
    print_info "Loading Xmodmap..."
    xmodmap "${HOME}/.Xmodmap" || print_error "Failed to load Xmodmap."
  else
    print_error "Can't load Xmodmap due to missing files."
  fi
}

Xrdb() {
  if [ -f "${HOME}/.Xresources" -a -x "$(which xrdb)" ]; then
    print_info 'Loading X ressources...'
    xrdb -merge "$HOME/.Xresources" || print_error 'Failed to load X ressources'
  fi
}

# Run urxvt daemon
Urxvtd() {
  if [ -x "$(which urxvtd)" ]; then
    print_info "Launching urxvt daemon..."
    urxvtd --quiet --opendisplay --fork || print_error "Failed to launch urxvt daemon"
  fi
}

Xrdb
Xmodmap
# exec dwm