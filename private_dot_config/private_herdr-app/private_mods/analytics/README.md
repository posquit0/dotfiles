# Analytics

Native Herdr dashboard based on [Insights](https://github.com/GaganSD/coding-agent-toolkit/tree/main/herdr-insights), with optional account usage. Upstream revision and attribution are in [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE).

## Open

Press **Cmd+Shift+A** or click **Analytics** at the right of the top tab bar. Both toggle a large overlay without creating a tab. Close it with the same shortcut, **Esc**, or the **×** button. The shortcut works in any layout while Herdr is active; its single binding lives in `keys.json`. The overlay size and presentation live in this mod's `mod.json`.

The optional toolbar button is included in the chezmoi-managed `Offbit` layout, cloned from Herdr's `main` layout.

To select that layout on another machine:

```sh
chezmoi apply ~/.config/herdr-app/mods ~/.config/herdr-app/layouts/Offbit.json
herdr-app do layout.switch '{"name":"Offbit"}'
```

To apply the shortcut and open the dashboard directly from any layout:

```sh
chezmoi apply ~/.config/herdr-app/mods/analytics ~/.config/herdr-app/keys.json
herdr-app do mod.open '{"name":"analytics"}'
```

The toolbar button uses `{ "mod": "analytics", "props": { "mode": "toolbar" } }`; it starts no collector of its own. The layout retains Herdr's native tabs mod, with the Analytics button alongside it. Existing Analytics tabs remain usable, but the button and shortcut no longer create or select tabs.

## Machine selection

The popup's **Machine** menu selects **This computer** or a connected Herdr machine. It starts on the focused pane's machine, or the machine passed by the sidebar. The selection stays fixed while the popup is open, so changing pane focus does not unexpectedly change its data.

Overview, Sessions, History, Accounts and Settings all use the selected machine. Live agent rows and counts include only that machine. History covers session files on that machine; account limits cover its signed-in CLI accounts, which may be shared across machines. Kiro account limits are supported, but Kiro session-history collection is not. There is no cross-machine sum or merged session history.

Remote history uses Node >=22.15 on the connected core. On first selection, Analytics sends its compressed history-helper code to a content-addressed directory under the remote `HERDR_APP_HOME/data/analytics/helpers/` (default `~/.config/herdr-app`). This does not require a remote UI/mod installation. Each machine retains its own configuration, index and derived cache in `data/analytics/analytics.json` and sibling files. The existing bounded/background indexer runs there; only the prepared dashboard and scan metadata return to the local UI, not raw transcripts or credentials.

Switching machines clears the previous history and filters, and discards late results from the previous machine. Unavailable machines show an error instead of local data. Save or reset unsaved Settings edits before switching. Exports are saved on the local computer and identify the selected machine. Calendar filters use the viewing computer's date; recorded session days are calculated on the source machine.

## Sidebar usage limits

The `Offbit` layout pins `{ "mod": "analytics", "props": { "mode": "sidebar" } }` at the bottom of the sidebar. Offbit removes the Settings/Add machine footer and uses the custom `offbit-spaces` mod for numbered space rows; sync that mod together with the layout. Horizontal scrolling over Spaces cycles All → This computer → remote machines (alphabetically) → All, with reverse scrolling moving backward. All preserves machine folding; individual machine views show only that machine’s unfolded spaces. The header shows the scope, and its + button creates a space on the selected machine. Vertical scrolling still scrolls the list. Space numbers restart at 1 within each selected machine; All uses the complete ordered list, retaining numbers while groups are folded. In Offbit, Ctrl+1–9 and Ctrl+A then Shift+1–9 select those displayed numbers. Cmd+Alt+[ / ] and Ctrl+A then Up/Down move within the same scope and wrap at its ends. Selecting a folded group’s space in All unfolds that group. These key overrides only apply to the Offbit layout. It follows the **focused pane's machine**, including a focused remote terminal peek. On that machine, running Claude Code, Codex and Kiro agents are grouped by kind across spaces; live child agents count too. A kind disappears when none remain. The sidebar shows used percentages, bars, reset countdowns and the machine name. The collapsed sidebar shows icons and the highest main-window used percentage, with details on hover. Click a provider or the heading to open **Accounts** for that machine; the toolbar and shortcut start on the focused pane’s machine.

These are the limits of the CLI accounts signed in on the selected machine, not usage attributable to that machine. The same account on two machines shares its provider's quota. Main session/weekly limits and Kiro monthly credits appear in the sidebar; model-specific limits and overage details remain on Accounts. Missing data is never shown as zero, passed reset times require a new reading, and disconnected machines never fall back to the local account.

The sidebar respects **Account usage lookup** and shares each machine's five-minute cache, in-flight request and rate-limit backoff with its Accounts view. Its minute timer updates countdowns and checks for due refreshes while visible; focus changes check the selected machine immediately. The refresh button bypasses only the automatic interval. It does not start a session-history scan.

Remote lookups run the standalone `accounts.mjs` source once through Herdr's `exec(..., { on: machine })`. No helper is installed remotely and no credentials are copied back: only sanitized quota results return. A connected Herdr machine with `sh` and Node >=22.15 is required. The launcher runs from the remote home directory, preferring `~/.local/share/mise/shims/node`, otherwise `node` on PATH. It uses that machine's home, environment and native CLI credential stores. Renew missing or expired logins on that machine.

Node >=22.15 is required for the local SQLite readers. The chezmoi runtime template uses the existing mise Node shim, resolved from the home directory so project-specific Node pins do not affect the collector. `runtime.json` can instead name an absolute Node executable.

## Reading the dashboard

- **Overview** starts with live Herdr agents, ordered by attention needed. Filter to this space or agents needing input/review; click an agent to open its terminal. Parent/child context includes live child agents without a pane. This list is limited to the selected machine; its unavailable state is reported.
- Below that, select a period and optionally an agent tool, project, provider or model. Every usage metric in Overview and Sessions follows these filters. New input, output and input reuse explain what makes up the token total. Project changes compare the previous calendar period, with incomplete-history warnings.
- Click a project or tool to enter **Sessions**, then select a session to inspect its token components and models. The list shows the top 50 matching sessions by tokens; totals cover all matching sessions. Different tools' identical session IDs remain separate.
- **History** retains the original activity heatmap and lifetime statistics. Its period/facet filters apply to its Model usage section; the lifetime and activity sections cover all history on the selected machine.
- **Accounts** contains the **Account usage lookup** setting and, when enabled, account quota windows. These percentages are separate from historical token counts.

Agent types use Herdr's own icons in live-agent rows, session rows, tool usage and data coverage. Hover over an icon to see its name; the same name is exposed to accessibility tools. Live rows honor the running program's icon, while known historical sources use Herdr's bundled agent icons. Unrecognized tools show initials with their full name on hover. Account headings, filter menus and settings keep readable text labels.

The Data coverage card reports source availability, scan progress, unknown project/model fields and scan errors. Live status is not an outcome evaluation; finished does not imply successful. Local files cannot establish complete cross-device token history, task quality or tool-error rates. The [design benchmark](BENCHMARK.md) documents references, metric definitions and boundaries.

## Account usage lookup

**Disabled by default.** Enable **Account usage lookup** on the **Accounts** page to query account quotas. Existing preferences are preserved. Local session history, token totals, model rankings, activity heatmaps and period filters always work without account API access. Sources are Pi, Codex, Claude Code, OpenCode and Antigravity. Use Settings to change source paths, enabled sources, cache-token accounting and the local refresh interval.

Enabling the setting adds account-wide quota cards for the currently authenticated Claude, Codex and Kiro CLI accounts, including usage percentages and reset times. Automatic account lookup runs at most once every five minutes per machine across Analytics views. **Refresh accounts** checks immediately, including after renewing a CLI login; it does not wait for the automatic interval. In-flight requests are shared and cannot be duplicated. Server rate-limit responses block both automatic and manual retries until their retry time (five minutes if the server supplies no usable time). Errors are shown per provider rather than as zero usage. There are no automatic login flows, token refreshes or credential-file writes.

Each provider has its own card: the large number is **remaining quota**, and the bar shows **used quota**. Session and weekly windows are separate from model/feature limits. Codex's plan is shown when supplied by the API. **Low headroom** means at least 80% used; **Limit reached** means at least 100%. These describe the reported quota, not guaranteed request availability. Reset countdowns include the exact local time. A passed reset asks for a fresh reading instead of assuming the quota recovered. Readings older than ten minutes are marked as last known. **Refresh accounts** refreshes only quotas. Its label shows elapsed time while fetching or a live countdown when the server requires a pause. Completion reports the number of updated accounts and names unavailable providers. The display timer runs while Accounts is selected and does not issue network requests.

The account presentation follows [CodexBar's usage bars and reset countdowns](https://github.com/steipete/CodexBar). [ccusage](https://github.com/ccusage/ccusage) remains a reference for local token/cost reports; those measurements are not substituted for server-reported account limits.

Kiro shows monthly plan credits and, when the API reports an enabled positive allowance, overage credits separately. Each includes the used/allowed credit count. Overage is subtracted from total usage before calculating the plan gauge. Responses that combine bonus spending with plan spending show an unavailable-plan explanation rather than an inferred percentage. A missing allowance or reset time remains unavailable. This does not enable paid overage or change the Kiro account.

These APIs expose quota windows, not a complete token/billing history across devices. History charts stay scoped to the selected machine; quota percentages are never summed together or added to token totals. Organization billing/admin APIs are not used. Other providers remain local-only.

The setting and local snapshot are saved in Herdr's `shared.json` under `analytics.accounts`, retaining the existing inverse `localOnly` field for compatibility. Remote snapshots use `analytics.accounts.machine:<machine>`. Disabling account lookup hides account data and invalidates in-flight results on every machine, even if it is enabled again before a request finishes. A request already sent may finish, but no new account lookup starts. While disabled, account credentials are not read.

## Account sources

| Provider | Local credentials | Read-only endpoint |
|---|---|---|
| Codex | `$CODEX_HOME/auth.json`, otherwise `~/.codex/auth.json`; OAuth `tokens.access_token` and selected `account_id` | `https://chatgpt.com/backend-api/wham/usage` |
| Claude | `$CLAUDE_CONFIG_DIR/.credentials.json` for an explicit profile; otherwise macOS Keychain service `Claude Code-credentials` first, with `~/.claude/.credentials.json` as fallback (the file is primary on Linux) | `https://api.anthropic.com/api/oauth/usage` |
| Kiro | `$KIRO_DATA_DIR/data.sqlite3`, otherwise macOS `~/Library/Application Support/kiro-cli/data.sqlite3` (Linux `$XDG_DATA_HOME/kiro-cli/data.sqlite3`, default `~/.local/share/kiro-cli/data.sqlite3`); opened read-only | `GetUsageLimits` at `https://codewhisperer.us-east-1.amazonaws.com/` or `https://q.eu-central-1.amazonaws.com/`, according to the CLI profile region |

Kiro uses the CLI's `auth_kv` token record and `state` profile record. A missing profile uses the US East endpoint for Builder ID; an invalid profile or unsupported region fails without sending its token elsewhere. Expired credentials must be renewed in Kiro CLI. The lookup follows [CodexBar's Kiro API contract](https://github.com/steipete/CodexBar/blob/main/docs/kiro.md), without its chat-based fallback: no `/usage` chat, new CLI session, or automatic sign-in is started. Kiro account support does not add a local Kiro session-history collector.

Credentials must already exist. API-key-only Codex logins, custom Claude Keychain profiles and other applications' credential stores are not imported. The first Claude Keychain read may require macOS to allow access. Missing, expired or denied credentials are reported in the card; renew them in the corresponding CLI.

These account endpoints are not stable public billing APIs. Response changes can make a card unavailable. The implementation follows the documented request shapes in [CodexBar's Codex provider](https://github.com/steipete/CodexBar/blob/main/docs/codex.md) and [Claude provider](https://github.com/steipete/CodexBar/blob/main/docs/claude.md).

## Data and privacy

- Each machine’s usage metadata and scan state live under `~/.config/herdr-app/data/analytics/`; raw prompts and responses are not saved by the collector.
- Only sanitized quota windows and status messages are shared with the UI. Credentials remain in the short-lived Node helper. No token is placed in subprocess arguments, mod config, logs or Herdr shared state.
- Network mode sends existing credentials only to fixed Claude, Codex and Kiro provider hosts. Redirects are rejected. Session transcripts are never uploaded.
- Runtime data and credentials are not tracked by chezmoi. Export produces a Markdown report of the selected machine’s dashboard.

## Checks

```sh
~/.local/share/mise/shims/node --test lib/herdr-analytics.test.mjs lib/herdr-analytics-operations.test.mjs lib/herdr-analytics-ui.test.mjs lib/herdr-analytics-machines.test.mjs
herdr-app check ~/.config/herdr-app/mods/analytics
```

The first command runs from the chezmoi source directory. Tests use synthetic credentials and sessions, including offline isolation, response redaction, per-provider errors, rate-limit backoff, shared toggle state, late responses, local deduplication, scoped aggregation and UI navigation. `herdr-app check` validates eager native elements; also inspect the loaded dashboard in the running app.
