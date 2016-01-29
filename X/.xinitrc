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
    else
      print_error "Can't find ~/.Xresources file or xrdb command."
    fi
  }
  # Modify keymaps and pointer button mappings
  Xmodmap() {
    if [ -f "${HOME}/.Xmodmap" -a -x "$(which xmodmap)" ]; then
      print_info "Loading Xmodmap to modify keymaps and pointer button mappings..."
      xmodmap "${HOME}/.Xmodmap" || print_error "Failed to load Xmodmap."
    else
      print_error "Can't load Xmodmap due to missing files."
    fi
  }
  # Bind commands to certain keys or key combinations on the keyboard
  Xbindkeys() {
    if [ -f "${HOME}/.xbindkeysrc" -a -x "$(which xbindkeys)" ]; then
      print_info "Launching Xbindkeys to bind commands to certain keys..."
      # LC_ALL=C xbindkeys || print_error "Failed to launch Xbindkeys"
    else
      print_error "Can't find ~/.xbindkeysrc file or xbindkeys command."
    fi
  }
  # Configure personal fonts to use
  XsetFont() {
    if [ -x "$(which xset)" ]; then
      print_info "Launching Xset to configure personal fonts"
      # Append elements to the current font path
      xset +fp "${HOME}/.local/share/fonts"
      xset +fp "${HOME}/.fonts"
      # Cause the server to reread the font databases in the current font path
      xset fp rehash
    else
      print_error "Can't find xset command."
    fi
  }
  # Set an input method to support multi-languages
  SetIM() {
    setxkbmap -layout us
    print_info "Launching iBus daemon for input method"
    # Setup IM enviroment
    export GTK_IM_MODULE=ibus
    export QT_IM_MODULE=ibus
    export QT4_IM_MODULE=ibus
    export CLUTTER_IM_MODULE=ibus
    export XMODIFIERS=@im=ibus
    ibus-daemon --xim --daemonize
  }
### }}}


### Terminals {{{
  # Run urxvt daemon
  Urxvtd() {
    if [ -x "$(which urxvtd)" ]; then
      print_info "Launching Urxvt daemon..."
      urxvtd --quiet --opendisplay --fork || print_error "Failed to launch Urxvt daemon"
    else
      print_error "Can't find Urxvtd command."
    fi
  }
  # Run urxvt client
  Urxvtc() {
    if [ -x "$(which urxvtc)" ]; then
      print_info "Launching Urxvt Terminal Emulator Client..."
      (urxvtc || print_error "Failed to launch Urxvt") &
    else
      print_error "Can't find Urxvtc command."
    fi
  }
  # Run urxvt
  Urxvt() {
    if [ -x "$(which urxvt)" ]; then
      print_info "Launching Urxvt Terminal Emulator..."
      (urxvt || print_error "Failed to launch Urxvt") &
    else
      print_error "Can't find Urxvt command."
    fi
  }
### }}}


### Additionals {{{
  WALLPAPER_DIR="${HOME}/.wallpaper/"
  WALLPAPER_RANDOM_TIMER="15m"
  # Set a background image with Feh
  Feh() {
    if [ -x "$(which feh)" ]; then
      print_info "Launching Feh as Wallpaper Manager..."
      while true; do
        (find "$WALLPAPER_DIR" -type f \( -name '*.jpg' -o -name '*.png' \) -print0 |
          shuf -n1 -z | xargs -0 feh --bg-fill) || print_error "Failed to launch Feh"
        sleep $WALLPAPER_RANDOM_TIMER
      done &
    else
      print_error "Can't find feh command."
    fi
  }
  Xcursor() {
    export XCURSOR_THEME=Breeze-Obsidian
    export XCURSOR_SIZE=16
    # xsetroot -xcf "${HOME}/.icons/${XCURSOR_THEME}/cursors/left_ptr" "${XCURSOR_SIZE}" &
    # xsetroot -cursor_name left_ptr &
  }
  # Run XAutoLock for managing lock screen
  Xautolock() {
    if [ -x "$(which xautolock)" ]; then
      if [ -x "$(which i3lock)" ]; then
        print_info "Launching XAutoLock with i3lock locker..."
        (xautolock || print_error "Failed to launch xautolock") &
      else
        print_error "Can't find i3lock command."
      fi
    else
      print_error "Can't find xautolock command."
    fi
  }
  Xscreensaver() {
    if [ -x "$(which xscreensaver)" ]; then
      print_info "Launching Xscreensaver..."
      # xscreensaver -nosplash || print_error "Failed to launch Xscreensaver"
    else
      print_error "Can't find xscreensaver command."
    fi
  }
  # Run tint2 for a system panel and taskbar
  Tint2() {
    if [ -x "$(which tint2)" ]; then
      print_info "Launching Tint2 Taskbar..."
      ( (sleep 2s && tint2) || print_error "Failed to launch Tint2") &
    else
      print_error "Can't find tint2 command."
    fi
  }
  Pidgin() {
    if [ -x "$(which pidgin)" ]; then
      print_info "Launching Pidgin..."
      # To be update || print_error "Failed to launch urxvt daemon"
    else
      print_error "Can't find pidgin command."
    fi
  }
  # Run Thunar File Manager as daemon
  Thunar() {
    if [ -x "$(which thunar)" ]; then
      print_info "Launching Thunar File Manager as daemon..."
      (thunar --daemon || print_error "Failed to launch Thunar") &
    else
      print_error "Can't find thunar command."
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
  Xautolock
}


# xsetroot -solid darkgrey
# start-pulseaudio-x11 &
session=${1:-dwm}

case $session in
  awesome)
    Default
    Urxvtd
    Thunar
    # fix cursors. for a minute :/
    # xsetroot -cursor_name left_ptr
    print_info "Loading Awesome Window Manager..."
    exec awesome
    ;;
  dwm)
    Default
    Urxvtd
    Thunar
    print_info "Loading DWM Window Manager..."
    exec ~/.bin/dwm
    ;;
  openbox)
    Default
    (sleep 2 && compton) &
    Tint2
    print_info "Loading OpenBox Window Manager..."
    exec openbox-session
    ;;
  gnome)
    print_info "Loading GNOME Window Manager..."
    exec gnome-session
    ;;
  xfce4)
    print_info "Loading XFCE4 Window Manager..."
    exec xfce4-session
    ;;
  *)
    print_error "None of the valid WM has been selected, Aborting..."
    exit 1
    ;;
esac