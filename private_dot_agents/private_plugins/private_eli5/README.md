# eli5

Explain any topic like I'm 5.

```
/eli5 how does DNS work
```

Produces a HTML artifact with big pictures and very few words that explains the topic to someone who knows nothing about it.

## Origin

Vendored from the official community marketplace and repackaged in the
[Agent Plugins 1.0](https://agent-plugins.org/) layout so several agents can
share one copy.

- Upstream: <https://github.com/anthropics/claude-plugins-community/tree/main/eli5>
- Author: Thariq Shihipar · License: MIT

Only the manifests were added; `skills/eli5/SKILL.md` is upstream verbatim.

## Layout

```
eli5/
├── plugin.json                 # Agent Plugins 1.0  -> Cursor, Codex, ...
├── skills/eli5/SKILL.md        # shared by every client
└── .claude-plugin/plugin.json  # Claude Code
```

Canonical copy lives at `~/.agents/plugins/eli5/`; each client gets a symlink.
See the symlink templates under `private_dot_<client>/` in the chezmoi source.
