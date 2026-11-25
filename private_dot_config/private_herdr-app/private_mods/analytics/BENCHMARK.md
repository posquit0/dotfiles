# Analytics design benchmark

Reviewed 2026-11-16. This is a feature and data-model comparison, not a runtime performance contest. GitHub stars below are rounded popularity signals observed on that date, not quality scores. We selected established agent-observability projects plus tools especially relevant to local coding agents. No service or SDK from this comparison is required at runtime.

| Project | Popularity / license | Useful pattern | Applied in Analytics |
| --- | --- | --- | --- |
| [ccusage](https://github.com/ccusage/ccusage) | ~19.4k stars, MIT | Local usage reports by date, project, session and model; distinct cache categories | Selected-period totals, tool/project drilldowns, session breakdown, input reuse |
| [Langfuse](https://github.com/langfuse/langfuse) | ~37.5k stars, MIT core with separately licensed enterprise components | Overview leading to individual traces; nested agent observations | Overview → project/tool → session; live parent/child context |
| [AgentOps](https://github.com/AgentOps-AI/agentops) | ~6.0k stars, MIT | Session-level grouping of agents, calls and errors; explicit end-state semantics | Session identity includes tool; unknown status stays unknown; finished does not imply success |
| [Agenttrail](https://github.com/sodiumsun/agenttrail) | ~1.0k stars, MIT | Local coding-agent activity shown in project context, including a native Herdr view | Live agent list, attention-first ordering, space scope, direct navigation |
| [Phoenix](https://github.com/Arize-ai/phoenix) | ~12.3k stars, [Elastic License 2.0](https://github.com/Arize-ai/phoenix/blob/main/LICENSE) | Instrumented traces and evaluations, local operation | Explicit coverage and missing-data reporting; no invented latency/error/quality measurements |

Phoenix is included as a source-available comparator, not described here as OSI open source. These are design references; their source code was not copied. The original Insights code remains attributed separately in UPSTREAM.md.

## Questions the dashboard now answers

1. **Which agent needs me?** Overview lists working, input-blocked, finished-awaiting-review and idle agents from connected Herdr cores. It includes live unkept child agents and parent context. Select a row to focus/peek its terminal. Filter to this space or agents needing attention.
2. **Where did recorded usage go?** Today/week/month/year/all-time totals can be filtered by tool, project, provider and model. Project/tool rows open the corresponding sessions. The top five absolute project changes include projects with usage only in the prior period.
3. **Which sessions explain it?** Sessions aggregates the same tool/session across daily and model slices; it shows token components, observed dates and model breakdown. Session IDs from different tools are kept separate.
4. **Is cache dominating the number?** New input is uncached input plus cache writes. Input reuse is cache reads divided by uncached input + cache reads + cache writes. Reasoning is already included in output. Disabling cache accounting changes the token ranking but not the component values or reuse definition.
5. **Can I trust the coverage?** Source status, scan progress, errors, warnings, unknown metadata and last scan are shown. Prior-period percentage comparison is suppressed when records do not reach its start. Even when earlier records exist, completeness is not guaranteed. Current calendar days are partial.

## Boundaries chosen from the evidence

[Langfuse agent graphs](https://langfuse.com/docs/observability/features/agent-graphs) derive structure from nested/timed observations. Our daily usage rows do not contain those spans. Herdr's live parent relationship is useful, but is not a historical execution graph. Terminal addresses are not joined to transcript session IDs by guesswork.

[AgentOps session documentation](https://github.com/AgentOps-AI/agentops/blob/main/docs/v1/concepts/sessions.mdx) explicitly distinguishes successful, failed and indeterminate runs. Herdr's `done` means an agent finished while the user was away; looking at it changes that state. Therefore this dashboard does not compute a success rate, tool failure rate, latency percentile or productivity score from it.

Local history covers enabled local session files. Connected remote agent status covers a different scope. Account quotas cover authenticated accounts and are displayed separately. Neither live agents nor quota percentages are added to local token totals. Token volume is not subscription spend or money saved.

## Implementation and verification

- `analytics.js`: selected-period aggregation and Markdown export; `fleet.js`: live agent normalization; `main.js`: navigation and native views.
- Detail limits are visible: top 10 projects, top 50 sessions and top 8 models per selected session. Totals include the complete matching dataset. Live agents initially show five, expandable to 50.
- `lib/herdr-analytics-operations.test.mjs` covers filters, multi-model sessions, cross-tool identity, disappeared-project deltas, incomplete data, cache arithmetic, 12,000-row aggregation, export and child-agent handling.
- `lib/herdr-analytics-ui.test.mjs` invokes the real view callbacks for project → session → detail, page navigation, agent navigation and the lightweight toolbar.
- Account isolation and collector deduplication remain covered by `lib/herdr-analytics.test.mjs`. Native checks must also cover loaded views; an initial empty render alone does not validate asynchronous data.
