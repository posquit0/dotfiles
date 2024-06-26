#!/bin/bash

set -eufo pipefail

###############################################################################
# General
###############################################################################

# Disable auto-correct
defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false
# Disable automatic capitalization as it’s annoying when typing code
defaults write NSGlobalDomain NSAutomaticCapitalizationEnabled -bool false
# Disable smart quotes as they’re annoying when typing code
defaults write NSGlobalDomain NSAutomaticQuoteSubstitutionEnabled -bool false
# Disable automatic period substitution as it’s annoying when typing code
defaults write NSGlobalDomain NSAutomaticPeriodSubstitutionEnabled -bool false
# Disable smart dashes as they’re annoying when typing code
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false

###############################################################################
# Mission Control
###############################################################################

# Keep the Spaces arrangement
defaults write com.apple.dock mru-spaces -bool false
# Do not group windows by application
defaults write com.apple.dock expose-group-apps -bool false
# When switching to an app, switch to a space with open windows for this app
defaults write NSGlobalDomain AppleSpacesSwitchOnActivate -bool true
# Set up separate spaces for each display (if you use Spaces and have multiple displays)
defaults write com.apple.spaces spans-displays -int 0

###############################################################################
# Finder
###############################################################################

# Show all filename extensions
defaults write NSGlobalDomain AppleShowAllExtensions -bool true
# Show hidden files in the Finder
defaults write com.apple.finder AppleShowAllFiles -bool true
# Show status bar
defaults write com.apple.finder ShowStatusBar -bool true
# Show path bar
defaults write com.apple.finder ShowPathbar -bool true
# Choose the size of Finder sidebar icons
defaults write NSGlobalDomain NSTableViewDefaultSizeMode -int 1
# Set the default view style for folders without custom setting (Nlsv: List view, clmv: Column view, icnv: Icon view, glyv: Gallery view)
defaults write com.apple.finder FXPreferredViewStyle -string "Nlsv"
# Always search current folder
defaults write com.apple.finder FXDefaultSearchScope -string "SCcf"
# Keep folders on top when sorting by name
defaults write com.apple.finder _FXSortFoldersFirst -bool true
# Remove items in the bin after 30 days
defaults write com.apple.finder FXRemoveOldTrashItems -bool true

###############################################################################
# Desktop & Dock
###############################################################################

# Set position to left on screen
defaults write com.apple.dock orientation left
# Automatically hide and show the Dock
defaults write com.apple.dock autohide -int 1
# Change the Dock opening and closing animation times (defaults to 0.5)
defaults write com.apple.dock autohide-time-modifier -float "0.4"
# Change the Dock opening delay (defaults to 0.2)
defaults write com.apple.dock autohide-delay -float "0.3"
# Don’t show recent applications in Dock
defaults write com.apple.dock show-recents -bool false

# Set the icon size of Dock items
defaults write com.apple.dock tilesize -int 26
defaults write com.apple.dock largesize -int 32

# Minimize windows into their application’s icon
defaults write com.apple.dock minimize-to-application -bool true
# Change the Dock minimize animation
defaults write com.apple.dock mineffect -string suck

###############################################################################
# Menu Bar
###############################################################################

# Configure the time and date format for the menubar digital clock
defaults write com.apple.menuextra.clock DateFormat -string "\"EEE d MMM HH:mm:ss\""
# The clock indicator (which by default is the colon) will flash on and off each second
defaults write com.apple.menuextra.clock FlashDateSeparators -bool true

###############################################################################
# Mac App Store                                                               #
###############################################################################

# Enable the WebKit Developer Tools in the Mac App Store
defaults write com.apple.appstore WebKitDeveloperExtras -bool true
# Enable Debug Menu in the Mac App Store
defaults write com.apple.appstore ShowDebugMenu -bool true

###############################################################################
# Activity Monitor                                                            #
###############################################################################

# Show the main window when launching Activity Monitor
defaults write com.apple.ActivityMonitor OpenMainWindow -bool true

###############################################################################
# Clock                                                            #
###############################################################################

defaults write com.apple.menuextra.clock FlashDateSeparators -bool true

###############################################################################
# Keyboard
###############################################################################

# When a key is held down, the accents menu is displayed
defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool true
# Switche between keyboard layouts for writing in other languages
defaults write com.apple.HIToolbox AppleFnUsageType -int 1
# Behave `fn` keys as standard function keys
defaults write NSGlobalDomain com.apple.keyboard.fnState -bool true

###############################################################################
# Mouse & Trackpad
###############################################################################

# Right click for magic mouse
defaults write com.apple.AppleMultitouchMouse MouseButtonMode -string TwoButton

# Set click weight to `Medium`
defaults write com.apple.AppleMultitouchTrackpad FirstClickThreshold -int 1
# Trackpad: Tap
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool true
defaults write com.apple.AppleMultitouchTrackpad Clicking -bool true
defaults -currentHost write NSGlobalDomain com.apple.mouse.tapBehavior -int 1
defaults write NSGlobalDomain com.apple.mouse.tapBehavior -int 1
# Enable dragging with three finger drag
defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerDrag -bool true

###############################################################################
# Kill affected applications                                                  #
###############################################################################

for app in \
	"Dock" \
	"Finder" \
	"SystemUIServer"; do
	killall ${app} &>/dev/null
done
echo "Done. Note that some of these changes require a logout/restart to take effect."
