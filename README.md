# dotfiles


## Getting Started

```sh
$ chezmoi init --apply https://github.com/posquit0/dotfiles.git
```

## Comparing dotfiles

`czdiff` shows decrypted, rendered desired content on the left and local content
on the right. Run `czdiff` to browse changed managed files and encrypted
`.private-data` inputs, or `czdiff <path>` for
one target or source file. Standalone encrypted sources, such as
`.private-data/settings.yaml.asc`, open in HEAD mode because they have no local target.
Without a file argument, a left sidebar lists changed files with `ENC` (encrypted
source) or `TXT` (plain source) badges. Deleted files use their HEAD source for the
badge; templates that include encrypted data are still plain sources. The active
sidebar or diff pane has a highlighted rounded border.
Private inputs include modified, new, and deleted Git sources, compared after
decryption against HEAD. Re-encryption with identical plaintext is omitted.
Selecting a private input switches to HEAD because it has no local target;
returning to a managed file restores the selected local/HEAD mode.

Binary files such as PNGs show their format, byte size, SHA-256, and whether the
states differ, without running a text diff. Diff results are reused while scrolling
or switching focus. On macOS with ncurses 6.0, Ghostty uses an xterm-compatible
profile inside `czdiff` to avoid dropped horizontal border characters.

- `Tab`: switch the right pane between local and Git HEAD.
- `h`/`l` or left/right arrows: move focus between the sidebar and diff panes.
- `j`/`k` or up/down arrows in the sidebar: select a file; Enter: focus its diff.
- `e`: edit desired sources with `czedit`, or local files with `$VISUAL`/`$EDITOR`.
  HEAD is read-only; returning from the editor refreshes the comparison.
- `n`/`p`: next/previous file; `j`/`k` and Page Up/Down: scroll.
- `[`/`]`: scroll horizontally; `r`: refresh; `q`: quit.

All addition/deletion markers appear in the desired pane. `czedit` also accepts
ordinary source files and templates. Neither tool applies changes to local files
unless you explicitly edit the local pane.

Requires Python 3 with curses, chezmoi, Git, and tar. HEAD is rendered from a
temporary export of the committed sources and pinned submodules using the current
machine's configuration. Submodules must be initialized with those commits available.
The export is removed on exit; decrypted comparison content stays in memory.

Tests: `python3 -B -m unittest discover -s lib/tests -v` (integration tests also use
`age-keygen`).


## Contributing

This project follows the [**Contributor Covenant**](http://contributor-covenant.org/version/1/4/) Code of Conduct.

#### Bug Reports & Feature Requests

Please use the [issue tracker](https://github.com/posquit0/dotfiles/issues) to report any bugs or ask feature requests.


## Self Promotion

Like this project? Please give it a ★ on [GitHub](https://github.com/posquit0/dotfiles)! It helps this project **a lot**.
And if you're feeling especially charitable, follow [posquit0](https://www.posquit0.com) on [GitHub](https://github.com/posquit0).


## See Also

- [brewfile](https://github.com/posquit0/brewfile) - Brewfile to install softwares in macOS for engineers.
- [gitconfig](https://github.com/posquit0/gitconfig) - Git configurations.
- [tmux-conf](https://github.com/posquit0/tmux-conf) - TMUX Configuration for nerds with tpm.
- [vimrc](https://github.com/posquit0/vimrc) - Vim Configuration for nerds with vim-plug.
- [zsh](https://github.com/posquit0/zshrc) - Zsh Configuration for nerds with zplug.


## References

- [macOS defaults](https://macos-defaults.com/) - Uncomplete list of macOS `defaults` commands with demos.


## License

Provided under the terms of the [MIT License](https://github.com/posquit0/dotfiles/blob/main/LICENSE).

Copyright © 2014-2026, [Byungjin Park](https://www.posquit0.com).
