#!/bin/bash

set -eufo pipefail

###############################################################################

# Install gpg dependency
if which gpg > /dev/null; then
  echo "[!] 'gpg' is already installed. Skip installation."
else
  echo "[!] 'gpg' is not installed. Start installation."
  brew install gnupg
  echo "[+] Successfully installed 'gpg'."
fi
