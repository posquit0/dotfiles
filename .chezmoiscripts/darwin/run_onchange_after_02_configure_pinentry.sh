#!/bin/bash

set -eufo pipefail

if which pinentry-touchid >/dev/null; then
	pinentry-touchid -fix
fi
