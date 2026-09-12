#!/bin/bash

set -eufo pipefail


# Reload gpg-agent so config changes (e.g. cache TTL) take effect.
gpgconf --reload gpg-agent || true
