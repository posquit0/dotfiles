# eli15

Explain any topic like I'm 15.

```
/eli15 how does DNS work?
```

Creates a visual HTML explainer at a middle-school level. Uses everyday analogies,
connects them to real concepts, and explains the mechanism with a concrete example.
Essential technical terms are defined rather than omitted, and the limits of the
analogy are made explicit. Uses the user's language.

Inspired by the neighboring `eli5` plugin's visual HTML format, with original
instructions for deeper explanations.

## Layout

```
eli15/
├── plugin.json                 # shared Agent Plugins manifest; read directly by Codex
├── skills/eli15/SKILL.md        # shared instructions
└── .claude-plugin/plugin.json  # symlink to ../plugin.json
```

Canonical copy lives at `~/.agents/plugins/eli15/`; client symlinks are managed
by the templates under `private_dot_<client>/` in the chezmoi source.
