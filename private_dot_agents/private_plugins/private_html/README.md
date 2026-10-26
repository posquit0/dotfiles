# html

Standard single-file HTML documents built from fixed templates.

```
/html:report 결제 파이프라인 인수인계 문서
/html:slidedeck 쿠버네티스 네트워크 정책 교육자료
```

| Skill | What it makes |
|---|---|
| `report` | One-page report read top to bottom: sticky table of contents, tables, callouts, code, tabs and mermaid diagrams. Light/dark, print-to-PDF. |
| `slidedeck` | Slide deck for presenting: keyboard navigation, TOC overlay, document mode, fragments, terminal demo, SVG diagrams. 16:9 print-to-PDF. |

Each skill ships its design and behavior in `templates/`; a document only changes its content
and accent colors. Generated files carry `<meta name="generator">` plus a template version meta
so they can be found and migrated later.

## Layout

```
html/
├── plugin.json                       # shared Agent Plugins manifest; read directly by Codex
├── skills/report/SKILL.md            # shared instructions
├── skills/report/templates/report.html
├── skills/slidedeck/SKILL.md
├── skills/slidedeck/templates/deck.html
└── .claude-plugin/plugin.json        # symlink to ../plugin.json
```

Canonical copy lives at `~/.agents/plugins/html/`; client symlinks are managed
by the templates under `private_dot_<client>/` in the chezmoi source.
