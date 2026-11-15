# Floating Terminals

`Alt+S` opens the menu. Define its entries in `config.json`; changes are read
when the menu opens. Add as many entries as needed; the menu scrolls.

Press `/` to start fuzzy-searching names, IDs, commands and key aliases (for example, `lzg`
matches `lazygit`). Matching ignores case; space-separated words all need to
match. Exact and contiguous matches appear before scattered letters. Use
Up/Down to select, Enter to run, or click a result; Escape closes the menu.
Before entering search, configured shortcuts still launch immediately:
`Alt+S`, `g`. In search mode, letters enter text instead: `Alt+S`, `/`, `lzg`,
Enter. `/` is reserved for starting search. Text entry supports the native
input's editing, paste and IME behavior. Reopening the menu resets search.

```json
[
  { "id": "scratch", "key": "s", "session": "persistent", "scope": "tab" },
  { "id": "shell", "key": "f" },
  {
    "id": "git-dotfiles",
    "name": "Dotfiles git",
    "key": "g",
    "command": "lazygit",
    "cwd": "~/.local/share/chezmoi",
    "session": "ephemeral"
  }
]
```

| Field | Meaning | Default |
| --- | --- | --- |
| `id` | Unique, stable session identifier. Keep it when renaming an entry or changing its key. | Required |
| `key` | Key pressed **after Alt+S**, such as `g`, `1`, or `shift-g`. Use lowercase Herdr keystroke spelling. Each key must be unique; `/` starts search. Also searchable as an alias. | Required |
| `name` | Menu label. | `id` |
| `command` | Shell command, including arguments, executed through `/bin/zsh -lic` so `.zshrc` is loaded. Omit to open `/bin/zsh -l`. | Login shell |
| `cwd` | Initial working directory: absolute, `~`, `~/…`, or relative to the current directory. | Focused terminal's directory when the menu opens |
| `session` | `ephemeral` or `persistent`. | `ephemeral` |
| `scope` | `tab`: one session per tab; `space`: shared by tabs within one space; `global`: shared everywhere. | `tab` |

The launcher runs locally. If the focused space is remote, or there is no
current terminal directory, the default directory is the local home directory.
Keys are handled inside Herdr, not as macOS global hotkeys. To change the menu
shortcut itself, edit `global` → `mod.open:floatterm` in Herdr's `keys.json`.

## Sessions

- **Ephemeral:** selecting an entry starts it. If its popup was dismissed by
  clicking the background or closing the peek, selecting it shows that session
  again. Selecting it from inside its own popup ends the session; the next
  selection creates a fresh session in the selected directory.
- **Persistent:** selecting an entry reuses its running session within its scope.
  Selecting it from inside its own popup hides it; selecting it elsewhere shows
  it. Changes to `command` or `cwd` apply only after the old session ends.
- Each `id` has one session per scope, independent of directory changes. With the
  default `tab` scope, another tab or space opens a separate session in that
  tab's current directory. `space` shares a session between tabs in the same space;
  `global` shares it everywhere. Space and tab IDs, rather than display names,
  identify the scope, so renaming them keeps their sessions.
- Leaving the configured scope automatically hides its popup without ending
  the session. Returning automatically restores that popup and its keyboard
  focus. A `space` popup stays visible when switching tabs within the same
  space and restores when returning from another space; a `global` popup stays
  visible across spaces.
- Exiting the shell or program ends that session in either mode. `persistent` also enables
  herdr-core's `--keep`: after a lost session or reboot, the core can restore a
  **new shell**, not the original program or its in-memory state.
- Closing the **menu** with Escape or Alt+S does not stop a program. The standard
  terminal peek's close button only hides it, including an ephemeral session;
  use Alt+S followed by the entry's key from inside that popup to end an
  ephemeral session. Calling a hidden session shows it again in either mode.
  Popups explicitly dismissed with the close button, a background click, or
  the entry's shortcut do not automatically return when switching tabs.

Automatic restoration uses the `main-floatterm` layout, a copy of `main` with
a zero-height controller block (`floatterm-restore`, props
`{ "restorer": true }`). The controller stays alive after a popup closes and
reacts to navigation without polling. Other custom layouts need the same
controller block for automatic restoration. Pending visibility is held in
memory; restarting Herdr or reloading the mod clears it. Ended sessions and
deleted owner tabs/spaces are not reopened.

Changing `scope` selects a different session; it does not move or end the old
one. Sessions created before scope support remain accessible with `"scope":
"global"`. Closing a tab or space does not terminate its floating sessions;
end them before closing their owning tab/space if they are no longer needed.

Invalid JSON, duplicate IDs/keys, and invalid field values appear in the menu
instead of launching a partial configuration. Existing sessions are left alone.

This folder is managed by chezmoi. Edit its source copy, then apply this folder:

```sh
chezmoi apply ~/.config/herdr-app/mods/floatterm
herdr-app check ~/.config/herdr-app/mods/floatterm
```
