#!/bin/bash

set -eufo pipefail

# Share preferences only; keep device identity, server connections/permissions,
# window geometry, session state, and update bookkeeping local to each Mac.
# Quit and reopen Rex after applying these preferences to load them in the app.

###############################################################################
# Appearance
###############################################################################

defaults write com.superlogical.rex Workspace.appearance -string "dark"
defaults write com.superlogical.rex Workspace.darkThemeID -string "moss-cathedral"
defaults write com.superlogical.rex Workspace.lightThemeID -string "merino-light"
defaults write com.superlogical.rex Workspace.animationStyle -string "natural"

###############################################################################
# Tabs & Panes
###############################################################################

defaults write com.superlogical.rex Workspace.tabStyle -string "vertical"
defaults write com.superlogical.rex Workspace.sidebarPosition -string "left"
defaults write com.superlogical.rex Workspace.sidebarShowsActivity -bool false
defaults write com.superlogical.rex Workspace.tabIconTintMode -string "off"
defaults write com.superlogical.rex Workspace.balancesSplitsOnCreation -bool true
defaults write com.superlogical.rex Workspace.focusFollowsMouse -bool false
defaults write com.superlogical.rex Workspace.showsActivePaneBorder -bool true
defaults write com.superlogical.rex Workspace.inactivePaneFadeMode -string "both"
defaults write com.superlogical.rex Workspace.usesStandardInactiveWindowPaneStyles -bool true

###############################################################################
# Terminal
###############################################################################

# Install Hack Nerd Font Mono separately on each Mac.
defaults write com.superlogical.rex Workspace.terminalFontName -string "Hack Nerd Font Mono"
defaults write com.superlogical.rex Workspace.terminalSmoothScrolling -bool true
defaults write com.superlogical.rex Workspace.cursorShadersEnabled -bool true
defaults write com.superlogical.rex Workspace.cursorShader -string "comet"

###############################################################################
# Agents & Developer Options
###############################################################################

defaults write com.superlogical.rex rex.agents.names-sessions -bool true
defaults write com.superlogical.rex rex.developer-mode-enabled -bool true
defaults write com.superlogical.rex Workspace.experiments.usesNewQuickSwitcher -bool true

###############################################################################
# Updates
###############################################################################

defaults write com.superlogical.rex SUEnableAutomaticChecks -bool true
defaults write com.superlogical.rex SUAutomaticallyUpdate -bool true
