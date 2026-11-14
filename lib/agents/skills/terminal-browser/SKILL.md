---
name: terminal-browser
description: A real browser running inside the terminal. It splits the human's terminal pane automatically, so you can show a website side by side with the conversation, render HTML to visualize something, and drive whatever tab is open — snapshot, click, fill, eval — with the `terminal-browser action` subcommand.
---

When running in Codex, terminal pane discovery may be blocked by the sandbox.
If that happens, use the permission escalation supported by the current session,
only when its policy allows it. Other agents use their normal command permissions.

`terminal-browser open <url>` puts a browser in a terminal pane. On its own it
takes over the current pane. `--split right` (or `down`, `left`, `up`) opens a
new pane beside the human, which is how you show a page next to the
conversation. A path to a local html file works the same as a url, so writing a
page and opening it is a way to show something you built.

`terminal-browser ls` shows the browsers and tabs in this terminal tab, with the
tab ids the other commands take.

`terminal-browser action -- <command>` is an agent-browser compatible CLI for a
tab that is already open. It targets this terminal tab's browser and its active
tab unless you select another one.

When you use the terminal-browser action sub command, the user will visually
see in the browser tab an indication that you are acting on the browser tab. This
will automatically hide after a preset duration, where the countdown resets
everytime terminal-browser action is used. But its a much better experience
for the user if after the last time you plan to use terminal-browser action you
run terminal-browser action done, which immediately clears the indication
that you are using the browser tab

Some pages publish WebMCP tools: named actions with a JSON schema that the
page runs itself. agent-browser announces them when a page has them, and
`terminal-browser action -- webmcp list --json` shows the full schemas. Prefer
`terminal-browser action -- webmcp invoke <tool> --params '<json>'` over
snapshot, click and fill when a tool covers what you need; it is faster and
does not break when the layout changes. Tools can carry annotations. Treat
`readOnly: false` as a change to the user's data and `consequential: true` as
something to confirm with the user before invoking.

## Command reference

```
$ terminal-browser help
Usage: terminal-browser [url] [options]
       terminal-browser <command> [args]

  open                 Open the browser in a terminal pane
  ls                   List running browsers and their tabs
  setup                Configure terminals and agents so terminal-browser works best
  upgrade              Upgrade to the latest release
  new-tab              Open a tab here, and a browser too if there is none
  clear-browsing-data  Clear cookies, site data and cache, like a browser's Clear browsing data
  apps                 Lists registered terminal-browser apps
  register-app         Register a terminal-browser application
  unregister-app       Unregister a terminal-browser application
  shutdown             Stop the daemon
  config               Get and set settings and shortcuts
  action               Use the open browser through the agent-browser CLI

terminal-browser <command> --help for one command's options
terminal-browser --version prints the installed version
```

```
$ terminal-browser open --help
Usage: terminal-browser open [url] [options]

Opens the browser in the current pane. Pass --split to open it in a new
split pane instead.

The url can be a normal url, a localhost port, or a path to an html file.

Options:
  --split <direction>   Open in a new pane: right, left, down, up
  --size <fraction>     How much of the space the split takes (0.2 to 0.95)
  --ssh <user@host>     Perform all network requests through a remote server, then
                        proxy the result back to the local terminal-browser instance
  --allow-clipboard-read
                        Lets websites read from clipboard.
  --transparent         [placeholder copy: Let the terminal show through pages that do not paint
                        a background. Persist it with terminal-browser config set window.transparent on]
  --no-merge            Do not open the terminal-browser instance as a tab in a neighbor terminal-browser


Examples:
  terminal-browser open localhost:3000
  terminal-browser open ./report.html --split right
  terminal-browser open github.com/zenbu-labs --split down --size 0.4
  terminal-browser open --ssh dev@build-box localhost:8080
```

```
$ terminal-browser ls --help
Usage: terminal-browser ls [options]

Lists the browsers running in this terminal tab, each with its tabs. The tab
ids it prints are what --tab takes in terminal-browser action.

Options:
  --all               Every browser, not just this terminal tab
  --json              Machine readable, including cdp ports and pane ids
```

```
$ terminal-browser setup --help
Usage: terminal-browser setup

Sets up configuration to make terminal-browser work best, this includes:
- installing agent skills
```

```
$ terminal-browser upgrade --help
Usage: terminal-browser upgrade

Checks this install's release channel and installs the latest version. Does
nothing when already up to date.
```

```
$ terminal-browser new-tab --help
Usage: terminal-browser new-tab [url] [options]

Opens a tab in a browser already open. By default, if there is a single
browser open in the current terminal tab, it will open a tab in that browser.
If there are no browsers, a new browser will be opened with the specified tab
as the initial (if ran from a shell without a TTY, it will open in a split to
the right). If there are multiple browsers, new-tab will error and a
--browser <key> is a required argument (<key> can be found by running
terminal-browser ls)

Options:
  --browser <key>     A browser key from terminal-browser ls

Examples:
  terminal-browser new-tab github.com
  terminal-browser new-tab --browser 90107-1 localhost:3000
```

```
$ terminal-browser clear-browsing-data --help
Usage: terminal-browser clear-browsing-data [options]

Clears cookies and site data, and cached images and files, for every site in
every terminal-browser window, signing you out. Asks first when run in a
terminal; otherwise needs --yes. Reload open pages to see the change.

Options:
  -y, --yes           Clear without asking
  --cookies           Only clear cookies and site data
  --cache             Only clear cached images and files
  --browser <key>     A browser key from terminal-browser ls

Examples:
  terminal-browser clear-browsing-data
  terminal-browser clear-browsing-data --yes --cookies
```

```
$ terminal-browser apps --help
Usage: terminal-browser apps [--json]

Lists the id, name, and binary path of registered terminal-browser apps. Apps can be registered
using terminal-browser register-app. If an app is registered it can be opened through the terminal-browser
new tab command palette after searching for its name.
```

```
$ terminal-browser register-app --help
Usage: terminal-browser register-app --name <name> --bin <path> [--id <id>] [--args "…"]

Registers metadata for a terminal-browser application to ~/.local/share/terminal-browser-interop/apps/<id>.json. This enables functionality
when a user is using terminal-browser, and lets other applications discover terminal-browser apps.
```

```
$ terminal-browser unregister-app --help
Usage: terminal-browser unregister-app <id>

Remove application metadata from ~/.local/share/terminal-browser-interop/apps/<id>.json.
```

```
$ terminal-browser shutdown --help
Usage: terminal-browser shutdown

Every browser in a terminal pane shares one browser process as an optimization. To
fully quit terminal-browser operations, you can use this shutdown command. This will
close all open browsers.
```

```
$ terminal-browser config --help
Usage: terminal-browser config <list|get|set|unset|path> [key] [value]

Reads and writes the settings.json and shortcuts.json files.

Settings are addressed by their settings.json key. Shortcuts are addressed as
shortcuts.<command> and take a comma separated list of key chords, or none to
unbind. unset restores the default.

Commands:
  list                 List every setting and shortcut with its current value
  get <key>            Print the value of one key
  set <key> <value>    Set a key
  unset <key>          Restore a key to its default
  path                 Print the paths of the config files

Examples:
  terminal-browser config list
  terminal-browser config get search.engine
  terminal-browser config set telemetry.usage off
  terminal-browser config set updates.check off
  terminal-browser config set shortcuts.tab.new "cmd+t,ctrl+t"
  terminal-browser config set shortcuts.record.toggle none
  terminal-browser config unset render.fps
  terminal-browser config path
```

```
$ terminal-browser action --help
Usage: terminal-browser action [selectors] -- <command>

An agent-browser compatible CLI for the browser you already have open.
Everything after -- is an agent-browser command. With no selectors it targets
the browser in this terminal tab and that browser's active tab.

Selectors:
  --browser <key>     A browser key from terminal-browser ls
  --tab <id>          A tab id from terminal-browser ls
  --target <id>       A CDP target id
  --follow            Bring the tab to the front before running the command

Examples:
  terminal-browser action -- snapshot
  terminal-browser action -- click @e14
  terminal-browser action -- eval "document.title"
  terminal-browser action --browser 90107-1 --tab 2 -- fill @e3 "hello"
  terminal-browser action done
```
