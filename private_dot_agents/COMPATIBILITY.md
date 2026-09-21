# Agent 공통 스펙 호환표

업계에서 "한 번 만들어 여러 에이전트에서 쓰기"를 목표로 나온 공통 스펙들을 각 클라이언트가 어디까지 지원하는지 추적한다.
`~/.agents/` 를 canonical 저장소로 두고 각 클라이언트에 symlink 하는 구조(`README.md` of each plugin 참고)가
계속 유효한지 판단하는 근거 자료다.

- 마지막 확인: **2026-09-21**
- 범례: ✅ 지원 · 🟡 부분/변형 지원 · ❌ 미지원 · — 해당 없음 · ❓ 미확인
- 각 셀은 "표준 레이아웃/포맷을 **그대로** 읽는가"를 기준으로 채운다. 자체 포맷으로 같은 기능을 제공하면 🟡.

## 확인 기준 버전

| 클라이언트 | 확인 버전 | 확인 방법 |
|---|---|---|
| Claude Desktop | 2.2553.1 | 로컬 설치본 (`/Applications/Claude.app`) |
| Claude Code | 2.1.272 (로컬) / 2.1.278 (최신 changelog) | `claude --version`, GitHub CHANGELOG |
| ChatGPT (Desktop) | 26.908.70816 | 로컬 설치본 (`/Applications/ChatGPT.app`) + developers.openai.com/plugins |
| Codex CLI | 0.155.1 | `codex --version` |
| Cursor | 3.11 (문서 기준, 로컬 미설치) | cursor.com/docs/plugins, /docs/skills |
| Kiro IDE | 1.1.14 | 로컬 설치본, kiro.dev/docs (`.md` twin) |
| Kiro CLI | 2.22.1 | `kiro-cli --version`, kiro.dev/docs |
| Kiro Crew (kirocrew) | 0.7.0-insider.4 | `kirocrew --version`, kiro.dev/docs/crew |

## 스펙 개요

| 스펙 | 주관 | 무엇을 표준화하나 | 참고 |
|---|---|---|---|
| **AGENTS.md** | OpenAI 발의, agents.md | 프로젝트 지침 파일 이름·위치 (`AGENTS.md`, 하위 디렉토리 중첩) | <https://agents.md> |
| **MCP** (Model Context Protocol) | Anthropic 발의 → 오픈 거버넌스 | 도구/리소스/프롬프트 서버 프로토콜. stdio / Streamable HTTP / (legacy SSE) | <https://modelcontextprotocol.io> |
| **Agent Skills** | Anthropic 발의, agentskills.io | `skills/<name>/SKILL.md` (frontmatter `name`, `description`) + `scripts/ references/ assets/` | <https://agentskills.io> |
| **Agent Plugins 1.0.0** | TSC: Amazon·Cursor·Microsoft·OpenAI·Vercel (+Google, 2026-08-06 합류) | 플러그인 디렉토리 레이아웃: 루트 `plugin.json` + `skills/` + `mcp.json` + reverse-domain 확장 네임스페이스. `${PLUGIN_ROOT}`, `${PLUGIN_DATA}` | <https://agent-plugins.org> |
| **`.agents/` 디렉토리 관습** | 사실상 표준 (Codex·Cursor 주도) | `.agents/skills/`, `~/.agents/skills/`, `.agents/plugins/marketplace.json` — 특정 벤더 폴더가 아닌 공용 위치 | Codex/Cursor 문서 |

Agent Plugins 1.0.0 이 **표준화하지 않은 것**: 슬래시 커맨드, hooks, 서브에이전트, rules, LSP, 설치/배포/마켓플레이스,
권한·샌드박스, 시크릿(userConfig), 서명/출처 검증. 이것들은 전부 클라이언트별 포맷이다.

## 호환표

### AGENTS.md

| 클라이언트 | 지원 | 비고 |
|---|:---:|---|
| Claude Desktop | — | 프로젝트 지침 개념 없음 |
| Claude Code | 🟡 | **2.1.277+** — `CLAUDE.md` 가 없는 프로젝트에서만 fallback 으로 읽음. Bedrock/Vertex/Foundry 미지원. 로컬 2.1.272 는 미지원 → `@~/.config/AGENTS.md` import 방식 유지 |
| ChatGPT | — | Codex 모드에서만 의미 있음 (Codex 항목 참조) |
| Codex | ✅ | 네이티브. `~/.codex/AGENTS.md` (글로벌) + 프로젝트 루트/하위 중첩 |
| Cursor | ✅ | 프로젝트 루트 `AGENTS.md` 읽음 (`.cursor/rules/` 와 병행) |
| Kiro IDE | ✅ | `~/.kiro/steering/AGENTS.md` 또는 워크스페이스 루트/하위 디렉토리. inclusion mode 없이 항상 포함 |
| Kiro CLI | ✅ | IDE 와 동일 |
| Kiro Crew | ❓ | Crew 문서는 `.kiro/steering/*.md` 만 언급. 런타임이 kiro-cli 라 상속될 가능성 높지만 미확인 |

### MCP

| 클라이언트 | 지원 | 비고 |
|---|:---:|---|
| Claude Desktop | ✅ | `claude_desktop_config.json` (stdio), 원격 커넥터, `.mcpb` 번들, MCP Apps |
| Claude Code | ✅ | `.mcp.json` / `~/.claude.json`, `allowedMcpServers`/`deniedMcpServers` 정책 |
| ChatGPT | 🟡 | 원격(HTTPS) MCP 만. Developer mode 에서 등록, 로컬 stdio 는 별도 문의 필요 |
| Codex | ✅ | `~/.codex/config.toml` `[mcp_servers]`, stdio + HTTP |
| Cursor | ✅ | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| Kiro IDE | ✅ | `~/.kiro/settings/mcp.json`, `.kiro/settings/mcp.json`. stdio + HTTP/SSE, 서버 prompts/resources |
| Kiro CLI | ✅ | IDE 와 동일 파일 공유 |
| Kiro Crew | ✅ | 대시보드 Integrations 에서 관리, 에이전트별 스코프 가능 |

### Agent Skills (`SKILL.md`)

| 클라이언트 | 지원 | 스킬 디렉토리 | 비고 |
|---|:---:|---|---|
| Claude Desktop | 🟡 | claude.ai 계정 스킬 (zip 업로드 / 플러그인 번들) | 포맷은 동일하나 로컬 디렉토리 스캔 없음. Claude Code 와 계정 동기화(`syncClaudeAiSkills`) |
| Claude Code | ✅ | `~/.claude/skills/`, `.claude/skills/`, 플러그인 `skills/` | 표준 + 확장 frontmatter(`context: fork`, `disable-model-invocation`, `effort` 등). `~/.agents/skills/` 직접 스캔 ❌ → symlink |
| ChatGPT | 🟡 | 플러그인 번들로만 | Work 모드에서 `@plugin` 호출. 단독 스킬 디렉토리 없음 |
| Codex | ✅ | `~/.agents/skills/`, `.agents/skills/`, `~/.codex/skills/` | `.agents/` 관습의 원조. `$skill-name` 호출 |
| Cursor | ✅ | `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/` + 호환용 `.claude/skills/`, `.codex/skills/` | 재귀 탐색 지원(표준은 1단계만). `paths`, `disable-model-invocation`, Custom Mode 확장 |
| Kiro IDE | ✅ | `.kiro/skills/`, `~/.kiro/skills/` | `/skill-name` 슬래시 호출. `~/.agents/skills/` 직접 스캔 ❌ → symlink |
| Kiro CLI | ✅ | IDE 와 동일 | `$ARGUMENTS` 치환은 CLI 전용. 커스텀 에이전트는 `resources: ["skill://..."]` 명시 필요 |
| Kiro Crew | 🟡 | `~/.kiro/crew/skills/<name>/SKILL.md` | 표준 frontmatter + Crew 전용 `triggers`, `always`. IDE/CLI 스킬 디렉토리와 **별도** |

### Agent Plugins 1.0.0 (루트 `plugin.json` + `skills/` + `mcp.json`)

| 클라이언트 | 표준 레이아웃 | 자체 매니페스트 | 비고 |
|---|:---:|---|---|
| Claude Desktop | ❌ | claude.ai 플러그인 (Anthropic 포맷) | 웹/데스크톱 Chat, Cowork 에서 설치. 스킬은 전부, hooks/서브에이전트는 Cowork 만 |
| Claude Code | ❌ | `.claude-plugin/plugin.json` + `.mcp.json` | 루트 `plugin.json` 만 있으면 "No manifest found" 에러. `${CLAUDE_PLUGIN_ROOT}` 사용. **shim 2개 필요** (아래) |
| ChatGPT | ✅ | `extensions.com.openai` 또는 `.codex-plugin/plugin.json` (fallback) | Codex 와 universal plugin directory 공유. `~/.agents/plugins/marketplace.json` 개인 마켓플레이스 |
| Codex | ✅ | 동일 | 표준 `mcp.json` 우선. 훅에 `PLUGIN_ROOT` + 호환용 `CLAUDE_PLUGIN_ROOT` 둘 다 주입 |
| Cursor | ✅ | `.cursor-plugin/plugin.json` (병행 개발) | 스펙 준수 플러그인은 무변경 로드. `${CURSOR_PLUGIN_ROOT}`. 마켓플레이스는 `.cursor-plugin/marketplace.json` |
| Kiro IDE | ✅ | Powers = Agent Plugins (`plugin.json`) / legacy `POWER.md` | `keywords` 로 자동 활성화. `~/.kiro/powers/installed/` + `installed.json` |
| Kiro CLI | ✅ | IDE 설치 Power 자동 픽업 | 문서상 CLI v3 기능. 로컬 2.22.1 에서 eli5 Power 픽업 동작 확인 |
| Kiro Crew | ❌ | Crew Apps (`app.json`) | Agent Plugins 언급 없음. Apps 는 agents/skills/MCP/cron/UI 를 묶는 별도 포맷 |

## 이 저장소에서의 결론

1. **Skills 가 진짜 공통분모.** 8개 클라이언트 전부 `SKILL.md` 를 읽는다. canonical 은 `~/.agents/skills/`, `~/.agents/plugins/<p>/skills/` 에 두고 Claude·Kiro 는 symlink.
2. **Agent Plugins 는 Codex/ChatGPT/Cursor/Kiro 용.** Claude Code 는 `.claude-plugin/plugin.json` + `.mcp.json` shim 을 같은 디렉토리에 함께 둔다 (`plugins/eli5/` 참고). MCP 를 번들할 경우 `mcp.json` 은 `${PLUGIN_ROOT}`, `.mcp.json` 은 `${CLAUDE_PLUGIN_ROOT}` 로 **두 벌** 유지.
3. **AGENTS.md 는 Codex/Cursor/Kiro 네이티브, Claude Code 는 fallback.** 글로벌 지침은 `.chezmoitemplates/AGENTS.md.tmpl` 한 곳에서 렌더하고 `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`(import) 로 배포하는 현 구조 유지.
4. **MCP 서버 정의는 공통이지만 파일은 클라이언트별.** `.chezmoidata` 한 곳 → 각 `mcp.json.tmpl` 렌더.
5. **Kiro Crew 는 별개 취급.** 스킬 디렉토리(`~/.kiro/crew/skills/`)와 패키징(`app.json`)이 IDE/CLI 와 다르다. 필요해지면 symlink 추가.

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-09-21 | 최초 작성. Claude Code 2.1.277 AGENTS.md fallback 지원 반영 (로컬 2.1.272 는 미적용). Kiro CLI 문서상 Powers 는 v3 이지만 로컬 2.22.1 에서 동작 확인 |

## 다시 확인할 것

- Claude Code 가 루트 `plugin.json` / `~/.agents/skills/` 를 읽기 시작하는지 (릴리스 노트 `plugin.json`, `.agents` 키워드)
- Kiro Crew 의 AGENTS.md 상속 여부, Agent Plugins(Powers) 지원 여부
- Cursor 로컬 설치 시 버전 갱신
- Agent Plugins 1.x 에서 hooks/commands 가 표준에 들어오는지 (GitHub Discussions)
- Plugin4Shell(2026-09) 류 공급망 이슈 — 표준에 서명/출처 검증이 없으므로 각 클라이언트 패치 버전 추적

## 출처

- <https://agent-plugins.org> · <https://agentskills.io> · <https://agents.md> · <https://modelcontextprotocol.io>
- Claude Code CHANGELOG: <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>
- Claude 플러그인: <https://support.claude.com/en/articles/13837440-use-plugins-in-claude>
- OpenAI Plugins 패키징: <https://developers.openai.com/plugins/build/plugins>
- Cursor Skills / Plugins: <https://cursor.com/docs/skills> · <https://cursor.com/docs/reference/plugins>
- Kiro Skills / Steering / Powers / MCP: <https://kiro.dev/docs/skills.md> · <https://kiro.dev/docs/steering.md> · <https://kiro.dev/docs/powers/create.md> · <https://kiro.dev/docs/mcp.md>
- Kiro Crew Skills / Apps: <https://kiro.dev/docs/crew/capabilities/skills.md> · <https://kiro.dev/docs/crew/apps.md>
- Agent Plugins vs 벤더 포맷 비교 (2026-08-31): <https://startdebugging.net/2026/08/agent-plugins-1-0-vs-vendor-specific-plugin-formats/>
