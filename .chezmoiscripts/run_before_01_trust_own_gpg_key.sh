#!/bin/bash

set -eufo pipefail

# Fingerprint of my own key - same value as `recipient` in chezmoi.toml.
MY_KEY="74F3F6BE2D0EC4E8D00AFD490E44F71854180758"

# GnuPG keeps ownertrust in ~/.gnupg/trustdb.gpg, a file separate from the
# keyring itself, so it can be lost (fresh machine, trustdb reset, keyboxd
# migration) while the keys survive. Without an ultimately trusted key GnuPG
# cannot compute validity for anything, and encrypting to my own key fails with
# "Unusable public key" - which breaks every encrypted_*.asc in this repo.
#
# Runs on every apply (not run_onchange) because the trustdb can be reset
# without any change to this script.
if ! gpg --list-keys --with-colons "$MY_KEY" 2>/dev/null | grep -q '^pub:u:'; then
  echo "[!] Own GPG key is not ultimately trusted - restoring ownertrust."
  echo "${MY_KEY}:6:" | gpg --import-ownertrust
  echo "[+] Ownertrust restored."
fi
