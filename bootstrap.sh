#!/usr/bin/env bash
echo "Installing Posquit0's dotfiles"

# If Git is not installed, install it (Ubuntu only, since Git comes standard
# with recent XCode or CLT)
if [[ ! "$(type -P git)" && "$(cat /etc/issue 2> /dev/null)" =~ Ubuntu ]]; then
    echo "Installing Git"
    sudo apt-get -qq install git-core
fi

# If Git isn't installed by now, something exploded. We gots to quit!
if [[ ! "$(type -P git)" ]]; then
    echo "ERROR: Git should be installed. It isn't. Aborting."
    exit 1
fi

# Download or update.
if [[ ! -d ~/.dotfiles ]]; then
    # ~/.dotfiles doesn't exist? Clone it!
    echo "Cloning dotfiles to ~/.dotfiles"
    cd
    git clone --recursive https://github.com/posquit0/dotfiles.git ~/.dotfiles
    cd ~/.dotfiles
else
    # Make sure we have the latest files.
    echo "Updating dotfiles"
    cd ~/.dotfiles
    git pull
    git submodule update --init --recursive --quiet
fi

ln -fs ~/.dotfiles/.alias ~/
ln -fs ~/.dotfiles/ctags/.* ~/
ln -fs ~/.dotfiles/curl/.* ~/
ln -fs ~/.dotfiles/git/.* ~/
ln -fs ~/.dotfiles/irssi/.* ~/
ln -fs ~/.dotfiles/weechat/.* ~/
ln -fs ~/.dotfiles/screen/.* ~/
ln -fs ~/.dotfiles/tmux/.* ~/
ln -fs ~/.dotfiles/vim/.* ~/
ln -fs ~/.dotfiles/emacs/.* ~/
ln -fs ~/.dotfiles/wget/.* ~/
ln -fs ~/.dotfiles/zsh/.* ~/
ln -fs ~/.dotfiles/npm/.* ~/
ln -fs ~/.dotfiles/gdb/.* ~/
ln -fs ~/.dotfiles/ruby/.* ~/
ln -fs ~/.dotfiles/octave/.* ~/
git clone https://github.com/sstephenson/ruby-build.git ~/.rbenv/plugins/ruby-build

# start a server but don't attach to it
tmux start-server
# create a new session but don't attach to it either
tmux new-session -d
# install the plugins
~/.tmux/plugins/tpm/scripts/install_plugins.sh
# killing the server is not required
tmux kill-server

vim +PlugInstall +qall now
echo "Installation complete!"
