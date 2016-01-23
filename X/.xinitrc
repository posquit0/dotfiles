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


### Essentials {{{
  # Read a set of resources for X applications
  Xrdb() {
    if [ -f "${HOME}/.Xresources" -a -x "$(which xrdb)" ]; then
      print_info 'Loading X ressources...'
      xrdb -merge "$HOME/.Xresources" || print_error 'Failed to load X ressources'
    fi
  }
  # Modify keymaps and pointer button mappings
  Xmodmap() {
    if [ -f "${HOME}/.Xmodmap" -a -x "$(which xmodmap)" ]; then
      print_info "Loading Xmodmap..."
      xmodmap "${HOME}/.Xmodmap" || print_error "Failed to load Xmodmap."
    else
      print_error "Can't load Xmodmap due to missing files."
    fi
  }
  # Bind commands to certain keys or key combinations on the keyboard
  Xbindkeys() {
    if [ -f "${HOME}/.xbindkeysrc" -a -x "$(which xbindkeys)" ]; then
      print_info "Launching Xbindkeys..."
      # LC_ALL=C xbindkeys || print_error "Failed to launch Xbindkeys"
    fi
  }
  # Configure personal fonts to use
  XsetFont() {
    if [ -x "$(which xset)" ]; then
      print_info "Launching Xset to configure personal fonts"
      # Append elements to the current font path
      xset +fp "${HOME}/.fonts"
      # Cause the server to reread the font databases in the current font path
      xset fp rehash
    fi
  }
### }}}


### Terminals {{{
  # Run urxvt daemon
  Urxvtd() {
    if [ -x "$(which urxvtd)" ]; then
      print_info "Launching urxvt daemon..."
      urxvtd --quiet --opendisplay --fork || print_error "Failed to launch urxvt daemon"
    fi
  }
  # Run urxvt client
  Urxvtc() {
    if [ -x "$(which urxvtc)" ]; then
      print_info "Launching urxvt client..."
      (sleep 1; urxvtc) &
    fi
  }
  # Run urxvt
  Urxvt() {
    if [ -x "$(which urxvt)" ]; then
      print_info "Launching urxvt..."
      urxvt &
    fi
  }
### }}}


### Additionals {{{
  WALLPAPER_DIR="${HOME}/.wallpaper/"
  WALLPAPER_RANDOM_TIMER="15m"
  # Set a background image
  Feh() {
    if [ -x "$(which feh)" ]; then
      print_info "Launching Feh to set a background image..."
      while true; do
        (find "$WALLPAPER_DIR" -type f \( -name '*.jpg' -o -name '*.png' \) -print0 |
          shuf -n1 -z | xargs -0 feh --bg-fill) || print_error "Failed to launch Feh"
        sleep $WALLPAPER_RANDOM_TIMER
      done &
    fi
  }
  Xcursor() {
    export XCURSOR_THEME=Breeze-Obsidian
    export XCURSOR_SIZE=16
    xsetroot -xcf "${HOME}/.icons/${XCURSOR_THEME}/cursors/left_ptr" "${XCURSOR_SIZE}" &
    # xsetroot -cursor_name left_ptr &
  }
  SetIM() {
    setxkbmap -layout us
    # Setup IM enviroment
    export GTK_IM_MODULE=ibus
    export QT_IM_MODULE=ibus
    export QT4_IM_MODULE=ibus
    export CLUTTER_IM_MODULE=ibus
    export XMODIFIERS=@im=ibus
    ibus-daemon --xim --daemonize
  }
  Xscreensaver() {
    if [ -x "$(which xscreensaver)" ]; then
      print_info "Launching Xscreensaver..."
      # xscreensaver -nosplash || print_error "Failed to launch Xscreensaver"
    fi
  }
  Pidgin() {
    if [ -x "$(which pidgin)" ]; then
      print_info "Launching Pidgin..."
      # To be update || print_error "Failed to launch urxvt daemon"
    fi
  }
### }}}

[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup


Default() {
  Xrdb
  Xcursor
  Xmodmap
  XsetFont
  Feh
  SetIM
}


Default
# exec dwm
# xsetroot -solid darkgrey
# start-pulseaudio-x11 &
Urxvtd
exec ~/.bin/dwm &
# exec awesome &