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
defaults write com.apple.spaces spans-displays -bool false

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
# Disable the warning when changing a file extension
defaults write com.apple.finder FXEnableExtensionChangeWarning -bool false
# Save new documents to disk instead of iCloud
defaults write NSGlobalDomain NSDocumentSaveNewDocumentsToCloud -bool false
# Show folder icons in the window title bar (requires Full Disk Access for the terminal)
defaults write com.apple.universalaccess showWindowTitlebarIcons -bool true || echo "Skipped showWindowTitlebarIcons (needs Full Disk Access)"
# Remove the rollover delay before the title bar icon appears
defaults write NSGlobalDomain NSToolbarTitleViewRolloverDelay -float 0

###############################################################################
# Desktop & Dock
###############################################################################

# Set position to left on screen
defaults write com.apple.dock orientation -string "left"
# Automatically hide and show the Dock
defaults write com.apple.dock autohide -bool true
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

# Show seconds in the menubar digital clock
defaults write com.apple.menuextra.clock ShowSeconds -bool true
# Show the day of the week in the menubar digital clock
defaults write com.apple.menuextra.clock ShowDayOfWeek -bool true
# Always show the date in the menubar digital clock (0: when space allows, 1: always, 2: never)
defaults write com.apple.menuextra.clock ShowDate -int 1
# The clock indicator (which by default is the colon) will flash on and off each second
defaults write com.apple.menuextra.clock FlashDateSeparators -bool true

###############################################################################
# Screenshots                                                                 #
###############################################################################

# Save screenshots to a dedicated folder
mkdir -p "${HOME}/screenshots"
defaults write com.apple.screencapture location -string "${HOME}/screenshots"
# Disable the shadow around window captures
defaults write com.apple.screencapture disable-shadow -bool true

###############################################################################
# Activity Monitor                                                            #
###############################################################################

# Update stats every 2 seconds (1: very often, 2: often, 5: normally)
defaults write com.apple.ActivityMonitor UpdatePeriod -int 2
# Show CPU usage in the Dock icon (0: application icon, 5: CPU usage, 6: CPU history)
defaults write com.apple.ActivityMonitor IconType -int 5

###############################################################################
# Keyboard
###############################################################################

# When a key is held down, repeat the character instead of showing the accents menu
defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool false
# Set a fast key repeat rate (lower is faster; System Settings minimum is KeyRepeat=2)
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15
# Enable keyboard navigation to move focus between controls with Tab
defaults write NSGlobalDomain AppleKeyboardUIMode -int 2
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
# TextEdit                                                                    #
###############################################################################

# Use plain text for new documents
defaults write com.apple.TextEdit RichText -bool false
# Disable smart quotes
defaults write com.apple.TextEdit SmartQuotes -bool false

###############################################################################
# Time Machine                                                                #
###############################################################################

# Don’t offer newly connected disks as Time Machine backup destinations
defaults write com.apple.TimeMachine DoNotOfferNewDisksForBackup -bool true

###############################################################################
# Safari                                                                      #
###############################################################################

# Show the full URL in the address bar (requires Full Disk Access for the terminal)
defaults write com.apple.Safari ShowFullURLInSmartSearchField -bool true || echo "Skipped Safari settings (needs Full Disk Access)"

###############################################################################
# Kill affected applications                                                  #
###############################################################################

for app in \
	"Dock" \
	"Finder" \
	"SystemUIServer" \
	"ControlCenter"; do
	killall ${app} &>/dev/null
done
echo "Done. Note that some of these changes require a logout/restart to take effect."
