// Analytics: local token history with opt-in account quota lookup.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Input, InputState, Editor, EditorState, Popover } from "gpui-base";
import { exec, appHome, home, theme, settings, nextCommand, openOverlay, closeOverlay, props, run, readTextFile, writeTextFile, pickFolder, notify, spaces, shared, setShared, agents, terminals, machines, focused, checking, window as appWindow } from "herdr";
import { AccountState } from "./account-state.js";
import { accountCountdown, accountDuration, accountMachine, accountSidebarProviders, quotaPresentation } from "./account-presentation.js";
import { ACCOUNT_NODE_LAUNCHER, remoteAccountScript } from "./account-remote.js";
import { REMOTE_ANALYTICS_SETUP } from "./machine-runtime.js";
import { fleetSnapshot } from "./fleet.js";
import {
  PALETTES,
  clampRefreshSeconds,
  dashboardMarkdown,
  dayKey,
  dayLabel,
  formatBytes,
  formatCompact,
  formatDuration,
  formatHitRate,
  formatInt,
  formatTimestamp,
  initials,
  isDay,
  isPresentation,
  normalizeConfig,
  periodRange,
  projectName,
  todayKey,
  weekdayLabels,
} from "./analytics.js";
import {
  G,
  H,
  R,
  T,
  agentIcon,
  bodyText,
  button,
  card,
  cardHeader,
  controlInput,
  fieldLabel,
  iconButton,
  inset,
  metaLabel,
  mutedText,
  notice,
  pageTitle,
  segmented,
  statCell,
  stateCard,
  toggleSwitch,
  tokens,
} from "./ui.js";

const MIN_CELL = 12;
const MAX_CELL = 20;
const CELL_GAP = 2;
const DAY_LABEL_WIDTH = 30;

function shortFileName(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return index >= 0 ? value.slice(index + 1) : value;
}

/** Local-time filename stamp, so two exports never reuse a path. */
function exportStamp(date) {
  const two = (value) => String(value).padStart(2, "0");
  return `${dayKey(date)}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

// A leaderboard row needs its rank, avatar, a readable model name, and the token
// value. A preferred basis wraps columns without imposing a minimum wider than
// a narrow split pane; each column can still shrink to its available width.
const LEADERBOARD_COLUMN_BASIS = 300;

/**
 * Heatmap cells stay small on narrow views and grow up to MAX_CELL on wide
 * ones so the grid reads centered instead of pinned to the left edge. When even
 * MIN_CELL cannot fit, only the newest `fitWeeks` weeks are drawn (see
 * fitHeatmapWeeks), so the grid never overflows its row.
 */
export function heatmapMetrics(width, weekCount, zoom = 1, rowPx = null) {
  const viewWidth = Number.isFinite(width) ? width : 960;
  const weeks = Math.max(1, weekCount);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const pagePadding = (viewWidth < 620 ? G.md : viewWidth < 900 ? G.lg : G.xl) * 2;
  // The card's inner width: measured (rowPx, window pixels) once the card has
  // been laid out, estimated from the page and card padding before that.
  const measured = Number.isFinite(rowPx) && rowPx > 0;
  const available = measured ? rowPx / z : Math.max(320, Math.min(1180, viewWidth - pagePadding) - G.lg * 2);
  // Herdr draws each cell and gap on whole window pixels, so under app zoom a
  // week is round(cell·z) + round(gap·z) px wide rather than (cell + gap)·z; at
  // zoom 0.9 that is 13 px instead of 12.6, about one column over a year. Fit in
  // drawn pixels, then express the drawn sizes back in layout units.
  const drawnWeek = (size) => Math.round(size * z) + Math.round(CELL_GAP * z);
  // One pixel of slack: a centered grid can start on a fractional offset.
  const room = available * z - Math.round(DAY_LABEL_WIDTH * z) - 1;
  let cell = Math.max(MIN_CELL, Math.min(MAX_CELL,
    Math.floor((available - DAY_LABEL_WIDTH - (weeks - 1) * CELL_GAP) / weeks)));
  while (cell > MIN_CELL && weeks * drawnWeek(cell) > room) cell -= 1;
  const centered = weeks * drawnWeek(cell) <= room;
  const fitWeeks = centered ? weeks : Math.max(1, Math.min(weeks, Math.floor(room / drawnWeek(cell))));
  const weekWidth = drawnWeek(cell) / z;
  const contentWidth = Math.round(DAY_LABEL_WIDTH * z) / z + weeks * weekWidth;
  return { cell, weekWidth, contentWidth, centered, fitWeeks };
}

/**
 * The newest `count` weeks of a heatmap, with month spans trimmed to match. A
 * month cut down to one week keeps its span but, like any one-week month, draws
 * no label.
 */
export function fitHeatmapWeeks(heatmap, count) {
  const total = heatmap.weeks.length;
  if (count >= total) return { weeks: heatmap.weeks, months: heatmap.months };
  const start = total - count;
  const months = [];
  for (const month of heatmap.months) {
    const end = month.week + month.span;
    if (end <= start) continue;
    const from = Math.max(month.week, start);
    months.push({ ...month, week: from - start, span: end - from });
  }
  return { weeks: heatmap.weeks.slice(start), months };
}

/** Categorical chart palette that reads on both dark and light themes. */
const MODEL_CHART_COLORS = ["#5b8def", "#3fb27f", "#e0a23c", "#d96c92", "#8f6fe0", "#41b3ba", "#e2704f"];
const OTHER_CHART_COLOR = "#6f8fd1";
const CHART_HEIGHT = 168;

function modelChartColor(name, index) {
  if (name === "Other") return OTHER_CHART_COLOR;
  return MODEL_CHART_COLORS[index % MODEL_CHART_COLORS.length];
}

/** Bundled monochrome brand marks, tinted with the surrounding text color. */
const PROVIDER_LOGO_FILES = {
  openai: "openai.svg",
  anthropic: "anthropic.svg",
  google: "googlegemini.svg",
  gemini: "googlegemini.svg",
  deepseek: "deepseek.svg",
  xai: "xai.svg",
  meta: "meta.svg",
  mistral: "mistralai.svg",
  aws: "amazonaws.svg",
  amazon: "amazonaws.svg",
  bedrock: "amazonaws.svg",
  opencode: "opencode.svg",
  ollama: "ollama.svg",
};

export function providerLogo(provider) {
  const key = String(provider ?? "").toLowerCase().trim();
  if (!key || key === "unknown" || key === "unknown provider") return null;
  if (PROVIDER_LOGO_FILES[key]) return PROVIDER_LOGO_FILES[key];
  for (const [prefix, file] of Object.entries(PROVIDER_LOGO_FILES)) {
    if (key.startsWith(prefix)) return file;
  }
  return null;
}

const MODEL_LOGO_PATTERNS = [
  [/claude/i, "anthropic.svg"],
  [/gpt|\bo[1-9]/i, "openai.svg"],
  [/gemini/i, "googlegemini.svg"],
  [/deepseek/i, "deepseek.svg"],
  [/grok/i, "xai.svg"],
  [/mistral|mixtral|codestral/i, "mistralai.svg"],
  [/ollama/i, "ollama.svg"],
  [/llama/i, "meta.svg"],
];

export function modelLogo(model) {
  const key = String(model ?? "").toLowerCase().trim();
  if (!key || key === "unknown" || key === "unknown model") return null;
  const candidates = key.includes("/") ? [key.split("/").at(-1), key] : [key];
  for (const candidate of candidates) {
    for (const [pattern, file] of MODEL_LOGO_PATTERNS) {
      if (pattern.test(candidate)) return file;
    }
  }
  return null;
}

export function usageLogo(model, provider) {
  return modelLogo(model) ?? providerLogo(provider);
}
const MAX_FACET_OPTIONS = 250;
const DEFAULT_NODE = "node";
const RUNTIME_FILE = "mods/analytics/runtime.json";
const PRESENTER_FILE = "mods/analytics/presenter.mjs";
const ACTIVITY_TIMEOUT_MS = 35_000;

const HEAT_COLORS = {
  blue: {
    dark: ["#12324f", "#155e8a", "#1d86c4", "#4fb3f0"],
    light: ["#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"],
  },
  green: {
    dark: ["#12351f", "#166534", "#15803d", "#4ade80"],
    light: ["#dcfce7", "#86efac", "#22c55e", "#15803d"],
  },
  purple: {
    dark: ["#2a1b4d", "#4c1d95", "#6d28d9", "#a78bfa"],
    light: ["#ede9fe", "#c4b5fd", "#8b5cf6", "#6d28d9"],
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function sanitizeError(error) {
  let text;
  if (error && typeof error === "object") text = error.message ?? error.error ?? "";
  else text = String(error ?? "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) text = "Unknown error";
  return text.length > 420 ? `${text.slice(0, 417)}…` : text;
}

function resultError(result) {
  const stderr = String(result?.stderr ?? "").trim();
  const stdout = String(result?.stdout ?? "").trim();
  const text = stderr || stdout;
  if (!text) return `Collector exited with code ${result?.code ?? "?"}.`;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const message = parsed.error ?? parsed.message;
      if (message) return String(message);
      return `Collector exited with code ${result?.code ?? "?"}.`;
    }
  } catch {
    // Diagnostics are plain text.
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Node startup failures put an internal frame first; prefer the real exception line.
  const errorLine = lines.find((line) => /^(?:[A-Za-z][\w.]*Error|Error|error):/.test(line));
  return sanitizeError(errorLine || lines.find((line) => !/^at\s/.test(line)) || text);
}

function parseRuntimeNode(raw) {
  if (raw === null || raw === undefined) return DEFAULT_NODE;
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`runtime.json is not valid JSON: ${sanitizeError(error)}`, { cause: error });
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("runtime.json must contain one JSON object with a node string.");
  }
  if (typeof config.node !== "string") {
    throw new Error("runtime.json must contain a node string.");
  }
  const node = config.node.trim();
  if (!node) throw new Error("runtime.json node must not be empty.");
  if (/[\u0000-\u001f\u007f]/.test(config.node)) {
    throw new Error("runtime.json node must not contain NUL or control characters.");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(node) && !/^[a-z]:[\\/]/i.test(node)) {
    throw new Error("runtime.json node must be a Node executable path, not a URL.");
  }
  return node;
}

function parseSnapshot(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("The presentation helper returned no dashboard.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The presentation helper returned invalid JSON.");
  }
  if (!isPresentation(parsed)) {
    throw new Error("The presentation helper returned an unexpected dashboard payload.");
  }
  return parsed;
}

export function presentationKey(snapshot, options = {}) {
  return JSON.stringify({
    generatedAt: snapshot?.generatedAt ?? null,
    lastScanAt: snapshot?.lastScanAt ?? null,
    config: snapshot?.config ?? null,
    filters: options.filters ?? {},
    period: options.period ?? "all",
    year: options.year ?? null,
    heatmapMode: options.heatmapMode ?? "daily",
    selectedDay: options.selectedDay ?? null,
    today: options.today ?? null,
  });
}

function sameOptions(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function sourceKey(source, index) {
  return String(source?.id || source?.adapter || `source-${index}`);
}

function rootsText(source) {
  return Array.isArray(source?.roots) ? source.roots.join(", ") : "";
}

function splitRoots(text) {
  return String(text ?? "").split(/[\n,]+/).map((root) => root.trim()).filter(Boolean);
}

function sourceLabel(value, config) {
  const source = (config.sources ?? []).find((item) => item?.adapter === value || item?.id === value);
  return source?.label || (value === "unknown" ? "Unknown source" : value);
}

function sourceIcon(id, value, config, c) {
  const source = (config.sources ?? []).find((item) => item?.adapter === value || item?.id === value || item?.label === value);
  return agentIcon(id, source?.adapter || value, c, { label: source?.label });
}

function warningText(warning) {
  if (warning === null || warning === undefined) return "";
  if (typeof warning === "string") return warning;
  if (typeof warning === "object") return String(warning.message ?? warning.text ?? warning.error ?? "");
  return String(warning);
}

function sourceStatEntry(snapshot, source) {
  const map = snapshot?.sourceStats;
  if (!map || typeof map !== "object" || Array.isArray(map) || !source?.id) return null;
  const entry = map[source.id];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === "string") return { status: entry, stats: null, error: null };
  if (typeof entry !== "object") return null;
  return {
    status: String(entry.status ?? entry.state ?? ""),
    stats: entry.stats && typeof entry.stats === "object" ? entry.stats : entry,
    error: entry.error ?? entry.message ?? null,
  };
}

function sourceStatusColor(status, c) {
  if (status === "ok") return c.done;
  if (status === "error" || status === "missing") return c.destructive;
  if (status === "empty") return c.accent;
  return c.dim;
}

function sourceStatusLabel(status) {
  if (!status) return "unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? formatInt(number) : "—";
}

function statBytes(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? formatBytes(number) : "—";
}

function sourceStatsText(entry) {
  const stats = entry?.stats;
  if (!stats || typeof stats !== "object") return "";
  const parts = [];
  if (stats.files !== undefined) parts.push(`${statCount(stats.files)} files`);
  if (stats.filesRead !== undefined) parts.push(`${statCount(stats.filesRead)} read`);
  if (stats.errors) parts.push(`${statCount(stats.errors)} errors`);
  if (stats.bytesRead) parts.push(statBytes(stats.bytesRead));
  if (entry.error) parts.push(sanitizeError(entry.error));
  return parts.join(" · ");
}

function isDarkTheme(t) {
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(t?.background ?? ""));
  if (!match) return true;
  const number = Number.parseInt(match[1], 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue) < 128;
}

function heatColor(level, palette, dark) {
  if (level <= 0) return null;
  const set = HEAT_COLORS[palette] ?? HEAT_COLORS.blue;
  return (dark ? set.dark : set.light)[Math.min(3, level - 1)];
}

function changeColor(change, c) {
  if (change?.kind === "up" || change?.kind === "down") return c.mutedForeground;
  if (change?.kind === "new") return c.accent;
  return c.dim;
}

function allLabelFor(field) {
  if (field === "source") return "All sources";
  if (field === "provider") return "All providers";
  if (field === "model") return "All models";
  return "All projects";
}

function facetLabel(field, value, config) {
  if (field === "source") return sourceLabel(value, config);
  if (field === "provider") return value === "unknown" ? "Unknown provider" : value;
  if (field === "model") return value === "unknown" ? "Unknown model" : value;
  return value === "unknown" ? "Unknown project" : projectName(value);
}

function buildFacetOptions(field, facet, config) {
  const stats = facet?.stats ?? [];
  const options = stats.map((stat) => ({
    value: stat.value,
    label: facetLabel(field, stat.value, config),
    detail: field === "project" && stat.value !== "unknown" ? stat.value : "",
    meta: stat.meta ?? formatCompact(stat.tokens),
    tokens: stat.tokens,
    tooltip: stat.tooltip ?? `${formatInt(stat.tokens)} tokens · ${formatInt(stat.sessions)} sessions`,
  }));
  const seen = new Set(options.map((option) => option.value));
  if (field === "source") {
    for (const source of config.sources ?? []) {
      const value = String(source?.adapter || source?.id || "");
      if (!value || seen.has(value)) continue;
      options.push({
        value,
        label: source.label || value,
        detail: source.adapter ? `adapter ${source.adapter}` : "",
        meta: "no records",
        tokens: 0,
        tooltip: "Configured source with no indexed usage; check data coverage.",
      });
      seen.add(value);
    }
  }
  options.sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
  const total = facet?.total ?? 0;
  const truncated = Boolean(facet?.truncated) || options.length > MAX_FACET_OPTIONS;
  const visible = options.slice(0, MAX_FACET_OPTIONS);
  return {
    truncated,
    total,
    options: [
      { value: "all", label: allLabelFor(field), detail: "", meta: facet?.totalMeta ?? formatCompact(total), tokens: total, tooltip: facet?.totalTooltip ?? `${formatInt(total)} tokens` },
      ...visible,
    ],
  };
}

function selectedFacet(facet, value, field, config) {
  if (value === "all") return { value: "all", label: allLabelFor(field) };
  const found = (facet?.stats ?? []).find((stat) => stat.value === value);
  return { value, label: facetLabel(field, found?.value ?? value, config) };
}



function preferenceRow(label, control, c) {
  return h_flex().w_full().flex_wrap().gap(G.md).items_center().justify_between()
    .child(fieldLabel(label, c))
    .child(control);
}

export default class Analytics extends View {
  init(_props, cx) {
    this.toolbarMode = props()?.mode === "toolbar";
    this.sidebarMode = props()?.mode === "sidebar";
    this.overlay = props()?.overlay;
    this.closed = false;
    // The toolbar is a button, not a dashboard copy: no runtime read, collector,
    // command loop, timer or editor state belongs to it.
    if (this.toolbarMode) return;

    this.accountClients = new Map();
    this.machine = this.sidebarMode ? null
      : props()?.machine !== undefined ? props().machine : accountMachine(focused(), spaces());
    this.machineGeneration = 0;
    this.historyRuntime = null;
    this.runtimeCache = new Map();
    this.accounts = this.accountClient(this.machine);

    // The pinned quota view shares account requests, but never scans history.
    if (this.sidebarMode) {
      this.width = 268;
      this.nodeBinary = null;
      this.runtimeReady = false;
      this.runtimeTask = null;
      this.runtimeError = null;
      this.accountTimer = null;
      if (checking()) return;
      this.resolveRuntime(cx);
      this.accountTimer = cx.timer.every(60000, (timerCx) => {
        if (this.closed || !appWindow()?.visible) return;
        if (this.sidebarProviders().length) this.accountClient(this.sidebarMachine()).refresh(timerCx);
        timerCx.notify();
      });
      return;
    }

    this.snapshot = null;
    this.loading = false;
    this.error = null;
    this.width = 960;
    this.height = 800;
    this.filters = { source: "all", project: "all", provider: "all", model: "all" };
    this.period = "week";
    this.page = "overview";
    this.selectedSession = null;
    this.fleetScope = "all";
    this.showAllAgents = false;
    this.year = Number(todayKey().slice(0, 4));
    this.heatmapMode = "daily";
    this.selectedDay = todayKey();
    this.showSettings = false;
    this.openFilter = null;
    this.openOptions = null;
    this.configDraft = null;
    this.configText = "";
    this.configDirty = false;
    this.editorDirty = false;
    this.rootsDirty = false;
    this.refreshDirty = false;
    this.saving = false;
    this.exporting = false;
    this.exportTask = null;
    this.saveError = null;
    this.saveMessage = null;
    this.syncingInputs = false;
    this.syncingEditor = false;
    this.sourceInputs = new Map();
    this.refreshInput = null;
    this.configEditor = null;
    this.settingsTask = null;
    this.settingsQueued = false;
    this.timer = null;
    this.accountTimer = null;
    this.timerSeconds = null;
    this.commandTask = null;
    this.runtimeTask = null;
    this.runtimeReady = false;
    this.runtimeError = null;
    this.nodeBinary = null;
    this.dashboard = null;
    this.dashboardKey = null;
    this.dashboardPending = null;
    this.dashboardError = null;
    this.dashboardTimer = null;
    this.dashboardTask = null;
    this.progressTimer = null;
    this.scanContinueTimer = null;
    this.scanProgress = null;
    this.progressTask = null;
    this.progressGeneration = 0;
    this.activityTask = null;
    this.activityGeneration = 0;
    this.dashboardQueued = false;
    this.dashboardGeneration = 0;
    this.dashboardWatchdog = null;
    this.refreshWatchdog = null;
    this.saveWatchdog = null;
    this.years = [Number(todayKey().slice(0, 4))];

    if (checking()) return;
    this.resolveRuntime(cx);
    if (props()?.page === "accounts") this.setPage("accounts", cx);
    this.commandTask = cx.spawn(async (commandCx) => {
      for (;;) {
        let command;
        try {
          command = await nextCommand();
        } catch {
          break;
        }
        const name = String(command).replace(/^analytics\./, "");
        if (name === "refresh") this.refresh(commandCx);
        else if (name === "settings") this.openSettings(commandCx);
        else if (name === "dashboard") {
          this.showSettings = false;
          commandCx.notify();
        } else if (name.startsWith("period.")) {
          this.setPeriod(name.slice("period.".length), commandCx);
          commandCx.notify();
        } else if (name === "year.prev" || name === "year.next") {
          this.setYear(name === "year.prev" ? 1 : -1, commandCx);
          commandCx.notify();
        } else if (name.startsWith("heatmap.")) {
          const mode = name.slice("heatmap.".length);
          if (["daily", "weekly", "cumulative"].includes(mode)) {
            this.heatmapMode = mode;
            this.scheduleDashboard(commandCx, { force: true });
            commandCx.notify();
          }
        } else if (name === "filters.clear") {
          this.filters = { source: "all", project: "all", provider: "all", model: "all" };
          this.scheduleDashboard(commandCx, { force: true });
          commandCx.notify();
        }
      }
    });
  }

  close() {
    this.closed = true;
    if (this.toolbarMode) return;
    if (this.sidebarMode) {
      this.accountTimer?.cancel();
      this.runtimeTask?.cancel();
      return;
    }
    this.cancelDashboardWork();
    this.activityGeneration = (this.activityGeneration ?? 0) + 1;
    try { this.activityTask?.cancel(); } catch { /* already gone */ }
    this.activityTask = null;
    this.cancelProgress();
    try { this.timer?.cancel(); } catch { /* already gone */ }
    try { this.accountTimer?.cancel(); } catch { /* already gone */ }
    try { this.dashboardTimer?.cancel(); } catch { /* already gone */ }
    try { this.dashboardTask?.cancel(); } catch { /* already gone */ }
    try { this.dashboardWatchdog?.cancel(); } catch { /* already gone */ }
    try { this.refreshWatchdog?.cancel(); } catch { /* already gone */ }
    try { this.progressTimer?.cancel(); } catch { /* already gone */ }
    this.cancelScanContinue();
    try { this.saveWatchdog?.cancel(); } catch { /* already gone */ }
    try { this.exportTask?.cancel(); } catch { /* already gone */ }
    this.exportTask = null;
    try { this.settingsTask?.cancel(); } catch { /* already gone */ }
    try { this.commandTask?.cancel(); } catch { /* already gone */ }
    try { this.runtimeTask?.cancel(); } catch { /* already gone */ }
    try { this.refreshInput?.release(); } catch { /* already released */ }
    for (const state of this.sourceInputs.values()) {
      try { state.release(); } catch { /* already released */ }
    }
    try { this.configEditor?.release(); } catch { /* already released */ }
    this.refreshInput = null;
    this.configEditor = null;
    this.settingsTask = null;
    this.settingsQueued = false;
    this.sourceInputs = new Map();
  }

  editorOptions() {
    const t = theme();
    const options = {
      language: "json",
      value: this.configText || "{}",
      font_size: 12,
      line_numbers: true,
      folding: false,
      soft_wrap: false,
      syntax: {
        keyword: t.ansi5,
        string: t.ansi2,
        comment: t.dim,
        function: t.ansi4,
        type: t.ansi3,
        number: t.ansi1,
        constant: t.ansi6,
      },
    };
    if (settings()?.font_family) options.font_family = settings().font_family;
    return options;
  }

  // Native editor and source inputs are only needed while Settings is open.
  // The dashboard never constructs or syncs them during a background snapshot.
  ensureSettingsControls() {
    if (!this.snapshot && !this.configDraft) return null;
    const savedConfig = normalizeConfig(this.snapshot?.config ?? {});
    const config = this.configDirty || this.editorDirty ? this.draftConfig(savedConfig) : savedConfig;
    if (!this.configDraft) this.configDraft = deepClone(config);
    if (!this.configText) this.configText = prettyJson(this.configDraft);

    if (!this.configEditor) {
      this.configEditor = EditorState.new(this.editorOptions());
      this.configEditor.on("change", () => {
        if (this.syncingEditor || !this.configEditor) return;
        const value = this.configEditor.value();
        if (!this.editorDirty && value === this.configText) return;
        this.editorDirty = true;
        this.configDirty = true;
        this.saveMessage = null;
      });
      this.configEditor.on("blur", (_event, notifyCx) => {
        this.applyEditorDraft();
        notifyCx.notify();
      });
    }

    if (!this.refreshInput) {
      this.refreshInput = InputState.new({ value: String(config.refreshSeconds) });
      this.refreshInput.on("change", () => {
        if (this.syncingInputs) return;
        this.refreshDirty = true;
        this.configDirty = true;
        this.saveMessage = null;
      });
      this.refreshInput.on("blur", (_event, notifyCx) => notifyCx.notify());
      this.refreshInput.on("submit", (_event, submitCx) => this.saveConfig(submitCx));
    }
    return config;
  }

  syncSettingsControls() {
    if (!this.showSettings) return;
    const config = this.ensureSettingsControls();
    if (!config) return;
    if (!this.configDirty && !this.editorDirty) this.setEditorText(this.configText || prettyJson(config));
    this.ensureSourceInputs(config);
    if (!this.rootsDirty) this.syncSourceInputs(config);
    if (!this.refreshDirty) this.syncRefreshInput(config);
  }

  scheduleSettingsSync(cx) {
    if (!this.showSettings) return;
    if (this.settingsTask) {
      this.settingsQueued = true;
      return;
    }
    let task = null;
    task = cx.spawn(async (syncCx) => {
      try {
        if (this.showSettings) this.syncSettingsControls();
      } catch (error) {
        this.saveError = sanitizeError(error);
      } finally {
        if (this.settingsTask === task) this.settingsTask = null;
        if (this.showSettings && this.settingsQueued) {
          this.settingsQueued = false;
          this.scheduleSettingsSync(syncCx);
        }
        syncCx.notify();
      }
    });
    this.settingsTask = task;
  }

  busy() {
    return this.loading || this.saving;
  }

  dashboardCurrent() {
    return Boolean(this.dashboard)
      && this.dashboardKey === presentationKey(this.snapshot, this.dashboardOptions());
  }

  exportReady() {
    return !this.closed && this.dashboardCurrent() && !this.exporting && !this.busy()
      && !this.dashboardPending && !this.dashboardQueued;
  }

  resolveRuntime(cx) {
    if (this.closed || (this.runtimeTask && !this.runtimeReady)) return;
    const generation = this.machineGeneration;
    const machine = this.machine;
    const current = () => !this.closed && generation === this.machineGeneration;
    this.runtimeReady = false;
    this.runtimeError = null;
    this.loading = true;
    this.runtimeTask = cx.spawn(async (runtimeCx) => {
      if (!current()) return;
      try {
        if (machine !== null && !machines().some((entry) => entry.name === machine && entry.layout === "ready")) {
          throw new Error(`Machine ${machine} is unavailable. Reconnect it and retry.`);
        }
        let runtime = this.runtimeCache.get(machine);
        if (!runtime) {
          const raw = await readTextFile(this.runtimePath());
          if (!current()) return;
          const binary = parseRuntimeNode(raw);
          // Resolve mise from home rather than a project's Node pin.
          const local = await exec(binary, ["-p", "JSON.stringify({path:process.execPath,version:process.versions.node})"], { cwd: home() });
          if (!current()) return;
          if (local.code !== 0) throw new Error("Could not start Node. Check runtime.json.");
          const resolved = JSON.parse(local.stdout);
          const [major, minor] = resolved.version.split(".").map(Number);
          if (major < 22 || (major === 22 && minor < 15)) throw new Error("Node 22.15 or newer is required.");
          runtime = { node: resolved.path, home: home(), presenter: `${appHome()}/${PRESENTER_FILE}`, store: `${appHome()}/data/analytics/analytics.json` };
          if (machine !== null) {
            const bundle = await exec(resolved.path, [`${appHome()}/mods/analytics/machine-bundle.mjs`]);
            if (!current()) return;
            if (bundle.code !== 0) throw new Error("Could not package the Analytics history helpers.");
            const setup = await exec("sh", ["-c", ACCOUNT_NODE_LAUNCHER, "analytics-history", "--input-type=module", "-e", REMOTE_ANALYTICS_SETUP, bundle.stdout], { on: machine, timeout: 25000 });
            if (!current()) return;
            if (setup.code !== 0) throw new Error("Could not prepare Analytics on this machine. Check its connection and Node 22.15+ installation.");
            runtime = JSON.parse(setup.stdout);
          }
          this.runtimeCache.set(machine, runtime);
        }
        if (!current()) return;
        this.historyRuntime = runtime;
        this.nodeBinary = runtime.node;
      } catch (error) {
        if (!current()) return;
        this.nodeBinary = null;
        this.runtimeError = sanitizeError(error);
        this.error = this.runtimeError;
      } finally {
        if (current()) {
          this.runtimeReady = true;
          this.runtimeTask = null;
          this.loading = false;
        }
      }
      if (!current()) return;
      if (this.nodeBinary) {
        if (this.sidebarMode) {
          if (this.sidebarProviders().length) this.accountClient(this.sidebarMachine()).refresh(runtimeCx);
        } else {
          this.refresh(runtimeCx);
          this.schedule(runtimeCx);
        }
      }
      runtimeCx.notify();
    });
    cx.notify();
  }

  selectMachine(machine, cx) {
    if (machine === this.machine || this.saving || this.exporting || this.configDirty || this.editorDirty) return;
    this.machineGeneration++;
    this.activityGeneration++;
    this.cancelDashboardWork();
    this.cancelProgress();
    this.cancelScanContinue();
    this.cancelWatchdog("refresh");
    for (const field of ["activityTask", "runtimeTask", "timer", "settingsTask"]) {
      this[field]?.cancel();
      this[field] = null;
    }
    this.refreshInput?.release();
    this.configEditor?.release();
    for (const input of this.sourceInputs.values()) input.release();
    this.refreshInput = null;
    this.configEditor = null;
    this.sourceInputs.clear();
    this.settingsQueued = false;
    this.machine = machine;
    this.accounts = this.accountClient(machine);
    this.historyRuntime = null;
    this.nodeBinary = null;
    this.runtimeReady = false;
    this.runtimeError = null;
    this.loading = false;
    this.snapshot = null;
    this.dashboard = null;
    this.dashboardKey = null;
    this.dashboardError = null;
    this.error = null;
    this.filters = { source: "all", project: "all", provider: "all", model: "all" };
    this.selectedSession = null;
    this.showAllAgents = false;
    this.fleetScope = "all";
    this.year = Number(todayKey().slice(0, 4));
    this.years = [this.year];
    this.selectedDay = todayKey();
    this.showSettings = false;
    this.openFilter = null;
    this.openOptions = null;
    this.configDraft = null;
    this.configText = "";
    this.rootsDirty = false;
    this.refreshDirty = false;
    this.saveError = null;
    this.saveMessage = null;
    this.accounts.refresh(cx);
    this.resolveRuntime(cx);
    cx.notify();
  }

  historyHome() {
    return this.historyRuntime?.home ?? home();
  }

  runPresenter(args) {
    return exec(this.nodeBinary, args, { on: this.machine, cwd: this.historyHome() });
  }

  runtimePath() {
    return `${appHome()}/${RUNTIME_FILE}`;
  }

  presenterPath() {
    return this.historyRuntime?.presenter ?? `${appHome()}/${PRESENTER_FILE}`;
  }

  storePath() {
    return this.historyRuntime?.store ?? `${appHome()}/data/analytics/analytics.json`;
  }

  schedule(cx) {
    const seconds = clampRefreshSeconds(this.snapshot?.config?.refreshSeconds ?? 60);
    if (this.timer && this.timerSeconds === seconds) return;
    try { this.timer?.cancel(); } catch { /* already gone */ }
    this.timerSeconds = seconds;
    this.timer = cx.timer.every(seconds * 1000, (timerCx) => this.refresh(timerCx));
  }

  dashboardOptions() {
    return {
      filters: this.filters,
      period: this.period,
      year: this.year,
      heatmapMode: this.heatmapMode,
      selectedDay: this.selectedDay,
      today: todayKey(),
    };
  }

  // Analytics run in the Node presentation helper. QuickJS only stores the
  // compact result and renders it; no derivation runs in a render frame.
  progressPath() {
    return `${this.storePath()}.progress.json`;
  }

  // The collector writes a small progress file while scanning. Poll it only
  // while a refresh is in flight so the loading card can name the live file.
  armProgress(cx) {
    this.cancelProgress();
    // Self-terminating: if a refresh continuation is interrupted before its
    // finally runs, the poll must not leak into a permanent notify loop.
    let ticks = 0;
    const generation = this.progressGeneration;
    this.progressTimer = cx.timer.every(500, (timerCx) => {
      ticks += 1;
      if (!this.loading || ticks > 240) {
        this.cancelProgress();
        return;
      }
      if (this.progressTask) return;
      this.progressTask = timerCx.spawn(async (progressCx) => {
        let next = null;
        try {
          const parsed = JSON.parse(await readTextFile(this.progressPath(), { on: this.machine }));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            // Merge only allowlisted display metadata into the last foreground
            // view: a mid-file stream update must not drop discovery counters.
            const merged = { ...(this.scanProgress ?? {}) };
            let useful = false;
            for (const key of ["processed", "total", "filesRead", "bytesRead", "bytes", "decodedBytes"]) {
              const value = Number(parsed[key]);
              if (Number.isFinite(value) && value >= 0) {
                merged[key === "bytes" ? "decodedBytes" : key] = Math.floor(value);
                useful = true;
              }
            }
            if (typeof parsed.file === "string") {
              merged.file = parsed.file;
              useful = true;
            }
            if (typeof parsed.phase === "string") {
              merged.phase = parsed.phase;
              useful = true;
            }
            if (useful) next = merged;
          }
        } catch { /* the progress file is best-effort */ }
        if (generation !== this.progressGeneration || !this.loading) return;
        this.progressTask = null;
        const changed = (next?.processed ?? null) !== (this.scanProgress?.processed ?? null)
          || (next?.file ?? null) !== (this.scanProgress?.file ?? null)
          || (next?.decodedBytes ?? null) !== (this.scanProgress?.decodedBytes ?? null)
          || (next?.phase ?? null) !== (this.scanProgress?.phase ?? null);
        this.scanProgress = next;
        if (changed) progressCx.notify();
      });
    });
  }

  cancelProgress() {
    this.progressGeneration = (this.progressGeneration ?? 0) + 1;
    try { this.progressTimer?.cancel(); } catch { /* already gone */ }
    try { this.progressTask?.cancel(); } catch { /* already gone */ }
    this.progressTimer = null;
    this.progressTask = null;
    this.scanProgress = null;
  }

  // A bounded collector slice returns committed data with an explicit scan
  // state. Continue automatically while work remains; the next request
  // coalesces with any in-flight pane through the store lock.
  cancelScanContinue() {
    try { this.scanContinueTimer?.cancel(); } catch { /* already gone */ }
    this.scanContinueTimer = null;
  }

  scheduleScanContinue(cx) {
    const scan = this.snapshot?.scan;
    if (!scan || this.closed) {
      this.cancelScanContinue();
      return;
    }
    const delay = scan.status === "partial" ? 250
      : scan.status === "running" || scan.status === "starting" ? 900
        : scan.status === "reconfiguring" ? 500
          : null;
    if (delay === null) {
      this.cancelScanContinue();
      return;
    }
    if (this.scanContinueTimer) return;
    this.scanContinueTimer = cx.timer.after(delay, (timerCx) => {
      this.scanContinueTimer = null;
      if (this.closed) return;
      // A tick during an in-flight load/save must not be lost: refresh is a
      // no-op while busy, so keep the continuation armed until it can run.
      if (this.busy()) {
        this.scheduleScanContinue(timerCx);
        return;
      }
      this.refresh(timerCx);
    });
  }

  scanStatusLabel(scan) {
    if (!scan || typeof scan !== "object") return "";
    if (scan.status === "reconfiguring") return "Applying configuration…";
    const live = scan.live && typeof scan.live === "object" ? scan.live : null;
    const total = Number(live?.total ?? scan.total) || 0;
    const processed = Number(live?.processed ?? scan.processed) || 0;
    const file = shortFileName(live?.file);
    const decodedBytes = Number(live?.decodedBytes) || 0;
    if (scan.status === "running" || scan.status === "starting") {
      if (live && (file || decodedBytes > 0)) {
        const counts = total > 0
          ? `${formatInt(processed)} of ${formatInt(total)} files`
          : "in the background";
        return [`Indexing ${counts}`, file, decodedBytes > 0 ? `${formatBytes(decodedBytes)} decoded` : null]
          .filter(Boolean).join(" · ") + "…";
      }
      return total > 0
        ? `Indexing ${formatInt(processed)} of ${formatInt(total)} files…`
        : "Indexing in the background…";
    }
    if (scan.status === "partial") {
      return total > 0
        ? `Scanning ${formatInt(processed)} of ${formatInt(total)} files…`
        : "Scanning…";
    }
    return "";
  }

  armWatchdog(kind, cx) {
    const field = kind === "refresh" ? "refreshWatchdog" : "saveWatchdog";
    try { this[field]?.cancel(); } catch { /* already gone */ }
    const generation = this.activityGeneration;
    this[field] = cx.timer.after(ACTIVITY_TIMEOUT_MS, (timerCx) => {
      if (generation !== this.activityGeneration) return;
      this[field] = null;
      this.activityGeneration = (this.activityGeneration ?? 0) + 1;
      try { this.activityTask?.cancel(); } catch { /* already gone */ }
      this.activityTask = null;
      if (kind === "refresh" && this.loading) {
        this.loading = false;
        this.cancelProgress();
        this.error = "Refresh timed out after 35 seconds. Retry to try again.";
        timerCx.notify();
      }
      if (kind === "save" && this.saving) {
        this.saving = false;
        this.saveError = "Saving timed out after 35 seconds. Retry to try again.";
        timerCx.notify();
      }
    });
  }

  cancelWatchdog(kind) {
    const field = kind === "refresh" ? "refreshWatchdog" : "saveWatchdog";
    try { this[field]?.cancel(); } catch { /* already gone */ }
    this[field] = null;
  }

  cancelDashboardWork() {
    this.dashboardGeneration = (this.dashboardGeneration ?? 0) + 1;
    this.dashboardQueued = false;
    this.dashboardPending = null;
    try { this.dashboardTimer?.cancel(); } catch { /* already gone */ }
    this.dashboardTimer = null;
    try { this.dashboardTask?.cancel(); } catch { /* already gone */ }
    try { this.dashboardWatchdog?.cancel(); } catch { /* already gone */ }
    this.dashboardTask = null;
    this.dashboardWatchdog = null;
  }

  scheduleDashboard(cx, { force = false } = {}) {
    if (!this.snapshot || !this.nodeBinary || this.runtimeError) return;
    const options = this.dashboardOptions();
    const key = presentationKey(this.snapshot, options);
    if (!force && this.dashboard && this.dashboardKey === key) return;
    if (!force && this.dashboardPending === key) return;
    if (this.dashboardTask) {
      // Coalesce every filter/settings change made while a prepare is running.
      this.dashboardQueued = true;
      this.dashboardError = null;
      return;
    }
    try { this.dashboardTimer?.cancel(); } catch { /* already gone */ }
    this.dashboardPending = key;
    this.dashboardError = null;
    this.dashboardTimer = cx.timer.after(0, (timerCx) => {
      this.dashboardTimer = null;
      this.prepareDashboard(timerCx, key);
    });
  }

  prepareDashboard(cx, key) {
    if (!this.snapshot || !this.nodeBinary || this.runtimeError) return;
    const options = this.dashboardOptions();
    if (presentationKey(this.snapshot, options) !== key) {
      // A newer snapshot or filter replaced the request before the timer ran.
      this.scheduleDashboard(cx, { force: true });
      return;
    }
    const generation = (this.dashboardGeneration ?? 0) + 1;
    this.dashboardGeneration = generation;
    try { this.dashboardWatchdog?.cancel(); } catch { /* already gone */ }
    this.dashboardWatchdog = cx.timer.after(ACTIVITY_TIMEOUT_MS, (timerCx) => {
      this.dashboardWatchdog = null;
      if (generation !== this.dashboardGeneration) return;
      this.dashboardGeneration += 1;
      this.dashboardPending = null;
      this.dashboardQueued = false;
      try { this.dashboardTask?.cancel(); } catch { /* already gone */ }
      this.dashboardTask = null;
      this.dashboardError = "Preparing the dashboard timed out. Retry to try again.";
      timerCx.notify();
    });
    let task = null;
    task = cx.spawn(async (prepareCx) => {
      if (generation !== this.dashboardGeneration) return;
      try {
        const result = await this.runPresenter([
          this.presenterPath(),
          "prepare",
          "--store",
          this.storePath(),
          "--options",
          JSON.stringify(options),
        ]);
        if (result.code !== 0) throw new Error(resultError(result));
        const payload = parseSnapshot(result.stdout);
        if (generation !== this.dashboardGeneration) return;
        if (payload.error && !payload.dashboard) throw new Error(payload.error);
        if (!payload.dashboard) throw new Error("The presentation helper returned no dashboard.");
        if (!this.snapshot || presentationKey(this.snapshot, this.dashboardOptions()) !== key) return;
        this.dashboard = payload.dashboard;
        this.dashboardKey = key;
        if (Array.isArray(payload.dashboard.years) && payload.dashboard.years.length) this.years = payload.dashboard.years;
        this.dashboardError = null;
      } catch (error) {
        if (generation === this.dashboardGeneration && this.snapshot
          && presentationKey(this.snapshot, this.dashboardOptions()) === key) {
          this.dashboardError = sanitizeError(error);
        }
      } finally {
        if (generation === this.dashboardGeneration) {
          try { this.dashboardWatchdog?.cancel(); } catch { /* already gone */ }
          this.dashboardWatchdog = null;
          if (this.dashboardPending === key) this.dashboardPending = null;
          if (this.dashboardTask === task) this.dashboardTask = null;
          prepareCx.notify();
          if (this.dashboardQueued) {
            this.dashboardQueued = false;
            this.scheduleDashboard(prepareCx);
          }
        }
      }
    });
    this.dashboardTask = task;
  }

  refresh(cx) {
    if (this.closed || !this.runtimeReady) return;
    this.accounts.refresh(cx);
    if (this.runtimeError) {
      this.resolveRuntime(cx);
      return;
    }
    if (this.busy()) return;
    this.cancelScanContinue();
    const generation = (this.activityGeneration ?? 0) + 1;
    this.activityGeneration = generation;
    this.loading = true;
    this.error = null;
    cx.notify();
    this.armWatchdog("refresh", cx);
    this.armProgress(cx);
    const presenter = this.presenterPath();
    const store = this.storePath();
    const options = this.dashboardOptions();
    this.activityTask = cx.spawn(async (refreshCx) => {
      if (generation !== this.activityGeneration) return;
      let payload = null;
      let failure = null;
      try {
        const result = await this.runPresenter([
          presenter,
          "snapshot",
          "--store",
          store,
          "--home",
          this.historyHome(),
          "--options",
          JSON.stringify(options),
        ]);
        if (result.code !== 0) throw new Error(resultError(result));
        payload = parseSnapshot(result.stdout);
      } catch (error) {
        failure = error;
      } finally {
        if (generation === this.activityGeneration) {
          this.activityTask = null;
          this.loading = false;
          this.cancelWatchdog("refresh");
          this.cancelProgress();
          if (failure) {
            this.error = sanitizeError(failure);
            refreshCx.notify();
          }
        }
      }
      if (!payload || generation !== this.activityGeneration) return;
      this.error = null;
      try {
        this.applySnapshot(payload, refreshCx);
      } catch (error) {
        this.error = sanitizeError(error);
        refreshCx.notify();
      }
    });
  }

  exportMarkdown(cx) {
    if (!this.exportReady()) return;
    const now = new Date();
    const markdown = dashboardMarkdown(this.dashboard, { now, machine: this.machine ?? "This computer" });
    this.exporting = true;
    cx.notify();
    this.exportTask = cx.spawn(async (exportCx) => {
      let failure = null;
      let savedPath = null;
      try {
        const folder = await pickFolder({ prompt: "Export" });
        if (!folder) return;
        const base = String(folder).replace(/[\\/]+$/, "");
        savedPath = `${base}/analytics-${exportStamp(now)}.md`;
        await writeTextFile(savedPath, markdown, null);
      } catch (error) {
        failure = error;
      } finally {
        if (!this.closed) {
          this.exporting = false;
          this.exportTask = null;
          if (failure) {
            notify({ title: "Could not export Analytics", body: sanitizeError(failure), level: "error" });
          } else if (savedPath) {
            notify({ title: "Analytics exported", body: savedPath, level: "success" });
          }
          exportCx.notify();
        }
      }
    });
  }

  applySnapshot(payload, cx) {
    if (!isPresentation(payload)) throw new Error("The presentation helper returned an unexpected dashboard payload.");
    const snapshot = payload.snapshot;
    this.cancelDashboardWork();
    this.snapshot = snapshot;
    const savedConfig = normalizeConfig(snapshot.config);
    const today = todayKey();
    const years = Array.isArray(payload.dashboard?.years) && payload.dashboard.years.length
      ? payload.dashboard.years
      : [Number(today.slice(0, 4))];
    this.years = years;
    if (!Number.isInteger(this.year) || !years.includes(this.year)) this.year = years[0] ?? Number(today.slice(0, 4));
    if (!isDay(this.selectedDay)) this.selectedDay = today;

    // Publish the compact dashboard before editor and input host work so an
    // interruption there can never bring back a permanent Preparing screen.
    const optionsNow = this.dashboardOptions();
    const key = presentationKey(snapshot, optionsNow);
    if (payload.dashboard && sameOptions(payload.options, optionsNow)) {
      this.dashboard = payload.dashboard;
      this.dashboardKey = key;
      this.dashboardError = payload.error ? sanitizeError(payload.error) : null;
    } else {
      this.dashboard = null;
      this.dashboardKey = null;
      this.dashboardError = payload.error ? sanitizeError(payload.error) : null;
    }
    this.schedule(cx);
    if (!this.dashboard) this.scheduleDashboard(cx, { force: true });

    if (!this.configDirty && !this.editorDirty) {
      this.configDraft = deepClone(savedConfig);
      this.configText = prettyJson(this.configDraft);
    }

    // Only compact metadata and the prepared dashboard are applied here. The
    // native settings controls are created or synced by a separate Task after
    // this notification, so they can never interrupt the first dashboard frame.
    this.scheduleScanContinue(cx);
    cx.notify();
    if (this.showSettings) this.scheduleSettingsSync(cx);
  }

  draftConfig(fallback) {
    const base = this.configDraft ?? fallback ?? this.snapshot?.config ?? {};
    if (this.editorDirty && this.configEditor) {
      try {
        const parsed = JSON.parse(this.configEditor.value());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return normalizeConfig(parsed);
      } catch {
        // Invalid JSON keeps the last valid draft alive during background refreshes.
      }
    }
    return normalizeConfig(base);
  }

  setEditorText(text) {
    this.configText = text;
    if (!this.configEditor) return;
    this.syncingEditor = true;
    try {
      this.configEditor.set_value(text);
    } finally {
      this.syncingEditor = false;
    }
  }

  syncRefreshInput(config) {
    if (this.refreshDirty || !this.refreshInput) return;
    this.syncingInputs = true;
    try {
      this.refreshInput.set_value(String(config.refreshSeconds));
    } finally {
      this.syncingInputs = false;
    }
  }

  ensureSourceInputs(config = normalizeConfig(this.snapshot?.config ?? {})) {
    const next = new Map();
    const sources = config.sources ?? [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index] ?? {};
      const key = sourceKey(source, index);
      let state = this.sourceInputs.get(key);
      if (!state) {
        state = InputState.new({ value: rootsText(source), placeholder: "~/.harness/sessions" });
        state.on("change", () => {
          if (this.syncingInputs) return;
          this.rootsDirty = true;
          this.configDirty = true;
          this.saveMessage = null;
        });
        state.on("blur", (_event, notifyCx) => notifyCx.notify());
        state.on("submit", (_event, submitCx) => this.saveConfig(submitCx));
      }
      next.set(key, state);
    }
    for (const [key, state] of this.sourceInputs) {
      if (next.has(key)) continue;
      try { state.release(); } catch { /* already released */ }
    }
    this.sourceInputs = next;
  }

  syncSourceInputs(config) {
    if (this.rootsDirty) return;
    this.syncingInputs = true;
    try {
      const sources = config.sources ?? [];
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index] ?? {};
        const state = this.sourceInputs.get(sourceKey(source, index));
        if (state) state.set_value(rootsText(source));
      }
    } finally {
      this.syncingInputs = false;
    }
  }

  applyEditorDraft() {
    if (!this.editorDirty) return;
    try {
      const parsed = JSON.parse(this.configEditor.value());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      this.configDraft = parsed;
      const config = normalizeConfig(parsed);
      this.ensureSourceInputs(config);
      this.syncSourceInputs(config);
      this.syncRefreshInput(config);
    } catch {
      // Saving reports the parse error; keep the editor text untouched.
    }
  }

  updateDraft(mutator) {
    let base = this.configDraft;
    if (this.editorDirty) {
      try {
        const parsed = JSON.parse(this.configEditor.value());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
      } catch {
        // Keep the last valid draft when the editor is mid-edit or invalid.
      }
    }
    this.configDraft = deepClone(base ?? normalizeConfig(this.snapshot?.config ?? {}));
    mutator(this.configDraft);
    this.configDirty = true;
    this.editorDirty = false;
    this.saveMessage = null;
    this.setEditorText(prettyJson(this.configDraft));
    const config = normalizeConfig(this.configDraft);
    this.ensureSourceInputs(config);
    this.syncSourceInputs(config);
    this.syncRefreshInput(config);
  }

  buildConfigForSave() {
    let config;
    if (this.editorDirty) {
      let parsed;
      try {
        parsed = JSON.parse(this.configEditor.value());
      } catch (error) {
        throw new Error(`Configuration JSON is invalid: ${sanitizeError(error)}`, { cause: error });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Configuration must be a JSON object.");
      }
      config = parsed;
    } else {
      config = deepClone(this.configDraft ?? normalizeConfig(this.snapshot?.config ?? {}));
    }

    if (!Array.isArray(config.sources)) config.sources = [];
    if (this.rootsDirty || !this.editorDirty) {
      for (let index = 0; index < config.sources.length; index += 1) {
        const source = config.sources[index];
        if (!source || typeof source !== "object") continue;
        const state = this.sourceInputs.get(sourceKey(source, index));
        if (state) source.roots = splitRoots(state.value());
      }
    }

    if (this.refreshDirty || !this.editorDirty) {
      const current = this.refreshInput ? Number(this.refreshInput.value()) : Number(config.refreshSeconds);
      if (Number.isFinite(current)) config.refreshSeconds = clampRefreshSeconds(current);
    }
    config.refreshSeconds = clampRefreshSeconds(config.refreshSeconds);
    if (config.includeCache === undefined) config.includeCache = true;
    return config;
  }

  draftSignature() {
    return JSON.stringify({
      draft: this.configDraft,
      editor: this.configEditor?.value() ?? this.configText,
      roots: Array.from(this.sourceInputs ?? [], ([key, input]) => [key, input.value()]),
      refresh: this.refreshInput?.value(),
    });
  }

  saveConfig(cx) {
    if (this.closed || !this.runtimeReady) return;
    if (this.runtimeError) {
      this.saveError = this.runtimeError;
      cx.notify();
      return;
    }
    if (this.busy()) return;
    let config;
    try {
      config = this.buildConfigForSave();
    } catch (error) {
      this.saveError = sanitizeError(error);
      this.saveMessage = null;
      cx.notify();
      return;
    }
    const generation = (this.activityGeneration ?? 0) + 1;
    this.activityGeneration = generation;
    const draftSignature = this.draftSignature();
    this.saving = true;
    this.saveError = null;
    this.saveMessage = null;
    cx.notify();
    this.armWatchdog("save", cx);
    const presenter = this.presenterPath();
    const store = this.storePath();
    const options = this.dashboardOptions();
    this.activityTask = cx.spawn(async (saveCx) => {
      if (generation !== this.activityGeneration) return;
      let payload = null;
      let failure = null;
      try {
        const result = await this.runPresenter([
          presenter,
          "configure",
          "--store",
          store,
          "--home",
          this.historyHome(),
          "--config",
          JSON.stringify(config),
          "--options",
          JSON.stringify(options),
        ]);
        if (result.code !== 0) throw new Error(resultError(result));
        payload = parseSnapshot(result.stdout);
      } catch (error) {
        failure = error;
      } finally {
        if (generation === this.activityGeneration) {
          this.activityTask = null;
          this.saving = false;
          this.cancelWatchdog("save");
          if (failure) this.saveError = sanitizeError(failure);
          saveCx.notify();
        }
      }
      if (!payload || generation !== this.activityGeneration) return;
      const draftUnchanged = this.draftSignature() === draftSignature;
      if (draftUnchanged) {
        this.configDirty = false;
        this.editorDirty = false;
        this.rootsDirty = false;
        this.refreshDirty = false;
      } else {
        this.configDirty = true;
      }
      this.error = null;
      this.saveError = null;
      try {
        this.applySnapshot(payload, saveCx);
        this.saveMessage = draftUnchanged ? "Configuration saved." : "Saved. Newer edits are still unsaved.";
      } catch (error) {
        this.saveError = sanitizeError(error);
      }
      saveCx.notify();
    });
  }

  resetConfigDraft(cx) {
    if (!this.snapshot) return;
    const config = normalizeConfig(this.snapshot.config);
    this.configDirty = false;
    this.editorDirty = false;
    this.rootsDirty = false;
    this.refreshDirty = false;
    this.configDraft = deepClone(config);
    this.setEditorText(prettyJson(this.configDraft));
    this.ensureSourceInputs(config);
    this.syncSourceInputs(config);
    this.syncRefreshInput(config);
    this.saveError = null;
    this.saveMessage = "Reset to the saved configuration.";
    cx.notify();
  }

  formatConfigEditor(cx) {
    try {
      const parsed = JSON.parse(this.configEditor.value());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Configuration must be a JSON object.");
      }
      this.configDraft = parsed;
      this.editorDirty = true;
      this.configDirty = true;
      this.setEditorText(prettyJson(parsed));
      this.applyEditorDraft();
      this.saveError = null;
      this.saveMessage = "Formatted.";
    } catch (error) {
      this.saveError = sanitizeError(error);
      this.saveMessage = null;
    }
    cx.notify();
  }

  openSettings(cx) {
    this.showSettings = true;
    this.syncSettingsControls();
    cx.notify();
  }

  setPeriod(period, cx) {
    this.period = period;
    const today = todayKey();
    const config = normalizeConfig(this.snapshot?.config ?? {});
    if (period === "year") {
      const years = this.years?.length ? this.years : [Number(today.slice(0, 4))];
      if (!years.includes(this.year)) this.year = years[0] ?? Number(today.slice(0, 4));
    }
    this.selectedDay = periodRange(period, { today, weekStartsOn: config.weekStartsOn, year: this.year }).end;
    this.scheduleDashboard(cx, { force: true });
  }

  setYear(delta, cx) {
    const today = todayKey();
    const years = this.years?.length ? this.years : [Number(today.slice(0, 4))];
    const current = Math.max(0, years.indexOf(this.year));
    const next = Math.min(years.length - 1, Math.max(0, current + delta));
    this.year = years[next] ?? Number(today.slice(0, 4));
    const config = normalizeConfig(this.snapshot?.config ?? {});
    this.selectedDay = periodRange("year", { today, weekStartsOn: config.weekStartsOn, year: this.year }).end;
    this.scheduleDashboard(cx, { force: true });
  }

  setPage(page, cx) {
    this.page = page;
    this.accountTimer?.cancel();
    this.accountTimer = page === "accounts" ? cx.timer.every(1000, (timerCx) => {
      if (!this.closed && !this.showSettings) timerCx.notify();
    }) : null;
  }

  render(_cx) {
    if (this.toolbarMode) return this.toolbar();
    if (this.sidebarMode) {
      if (!checking() && appWindow()?.visible && this.sidebarProviders().length) {
        this.accountClient(this.sidebarMachine()).refresh(_cx);
      }
      return this.accountSidebar();
    }
    const c = tokens(theme());
    const width = this.width || 960;
    const padding = width < 620 ? G.md : width < 900 ? G.lg : G.xl;
    const content = [this.header(c)];
    if (!this.showSettings) content.push(segmented("analytics-pages", [
      { key: "overview", label: "Overview" }, { key: "sessions", label: "Sessions" },
      { key: "history", label: "History" }, { key: "accounts", label: "Accounts" },
    ], this.page, (page, pageCx) => this.setPage(page, pageCx), c));
    if (!this.showSettings && this.page === "overview") content.push(this.fleetCard(c));
    if (this.error && this.snapshot) content.push(this.errorBanner(c));
    if (this.dashboardError && this.snapshot) content.push(this.dashboardErrorBanner(c));
    if (!this.showSettings && this.page === "accounts") content.push(this.accountCard(c));
    else if (!this.snapshot) content.push(this.initialState(c));
    else if (this.showSettings) content.push(this.settingsView(c));
    else content.push(this.dashboardView(c));

    return v_flex().id("analytics-root").size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => {
        // Sizes arrive in window pixels; layout values (w, h, size) are scaled by
        // the person's app zoom, so convert back before deriving any layout from
        // them. Without this, zoom < 1 underestimates the width (the heatmap
        // overflows and clips its newest weeks) and zoom > 1 overestimates it.
        const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
        const width = size.width / zoom;
        const height = size.height / zoom;
        const changed = Math.abs((this.width || 0) - width) >= 1;
        this.width = width;
        this.height = height;
        if (changed) sizeCx.notify();
      })
      .child(h_flex().w_full().justify_center().p(padding)
        .child(v_flex().w_full().max_w(1180).gap(G.lg).children(content)));
  }

  toolbar() {
    const t = theme();
    return h_flex().size_full().pr(10).items_center()
      .bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("analytics-open").h(26).px(8).gap(5).flex_none()
        .items_center().rounded(6).text_size(12).bg(t.chrome).text_color(t.muted)
        .hover((style) => style.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .tooltip("Analytics · ⌘⇧A")
        .on_click(() => run("mod.open", { name: "analytics" }))
        .child(svg("mods/analytics/analytics.svg").size(14))
        .child("Analytics"));
  }

  accountClient(machine) {
    if (!this.accountClients.has(machine)) this.accountClients.set(machine, new AccountState({
      shared, setShared, now: Date.now,
      ready: () => !this.closed && (machine === null ? Boolean(this.nodeBinary)
        : machines().some((entry) => entry.name === machine && entry.layout === "ready")),
      collect: async () => {
        if (machine === null) return exec(this.nodeBinary, [`${appHome()}/mods/analytics/accounts.mjs`, "--allow-network"]);
        const source = await readTextFile(`${appHome()}/mods/analytics/accounts.mjs`);
        if (!source) throw new Error("Account helper missing");
        return exec("sh", ["-c", ACCOUNT_NODE_LAUNCHER, "analytics-accounts", "--input-type=module", "-e", remoteAccountScript(source)],
          { on: machine, timeout: 25000 });
      },
      ...(machine === null ? {} : { failureMessage: "Cannot query this machine. Check its connection and Node 22.15+ installation (mise or PATH)." }),
    }, machine));
    return this.accountClients.get(machine);
  }

  sidebarMachine() {
    return accountMachine(focused(), spaces());
  }

  sidebarProviders() {
    const machine = this.sidebarMachine();
    return accountSidebarProviders(fleetSnapshot(agents(), terminals(), spaces(), machines()).rows.filter((row) => row.machine === machine));
  }

  openAccounts() {
    openOverlay({ mod: "analytics", props: { page: "accounts", machine: this.sidebarMachine() }, kind: "dialog", width: 0.9, height: 0.85 });
  }

  accountSidebar() {
    const t = theme();
    const c = tokens(t);
    const now = Date.now();
    const machine = this.sidebarMachine();
    const accounts = this.accountClient(machine);
    const state = accounts.state();
    const enabled = !accounts.localOnly();
    const providers = this.sidebarProviders();
    const compact = this.width < 160;
    const offline = machine !== null && !machines().some((entry) => entry.name === machine && entry.layout === "ready");
    const stale = offline || !state.updatedAt || now - state.updatedAt >= 10 * 60000;
    const status = accounts.refreshStatus({ manual: true });
    const pending = status.kind === "pending";
    const caption = !enabled ? "Lookup disabled" : offline ? "Machine unavailable" : pending ? "Updating…"
      : status.kind === "rate-limited" ? `Retry in ${accountDuration(status.waitMs)}`
      : machine === null && this.runtimeError ? "Helper unavailable"
      : stale && state.updatedAt ? "Last known usage"
      : state.updatedAt ? `Updated ${accountDuration(now - state.updatedAt)} ago` : "Waiting for usage";
    const root = v_flex().id("analytics-sidebar").size_full().min_h(0).bg(t.chrome)
      .border_t(2).border_color(t.input).px(compact ? 6 : 12).py(10).gap(10)
      .text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => {
        const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
        const width = size.width / zoom;
        if (Math.abs(this.width - width) >= 1) { this.width = width; sizeCx.notify(); }
      });
    const open = div().id("analytics-sidebar-open").flex_1().min_w(0).cursor_pointer()
      .tooltip(`Account limits · CLI accounts on ${machine ?? "this Mac"}. Follows the focused pane's machine.`)
      .on_click(() => this.openAccounts())
      .child(compact ? svg("mods/analytics/analytics.svg").size(16) : h_flex().gap(7).items_center().text_color(t.foreground)
        .child(svg("mods/analytics/analytics.svg").size(14).flex_none())
        .child(div().text_size(12).font_bold().child("USAGE LIMITS")));
    root.child(h_flex().w_full().items_center().gap(6).child(open)
      .when(!compact && enabled && providers.length > 0, (el) => el.child(div()
        .id("analytics-sidebar-refresh").size(20).rounded(4).flex().items_center().justify_center()
        .text_color(status.kind === "ready" ? c.mutedForeground : c.dim)
        .hover((style) => style.bg(t.hover))
        .tooltip(status.kind === "ready" ? "Refresh account limits" : caption)
        .on_click((_event, clickCx) => {
          if (machine === null && this.runtimeError) this.resolveRuntime(clickCx);
          else accounts.refresh(clickCx, { manual: true });
        })
        .child(pending ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)
          : div().text_size(15).child("↻")))));
    if (!enabled) return root.child(div().id("analytics-sidebar-enable").text_size(11)
      .cursor_pointer().tooltip("Enable account usage lookup in Analytics → Accounts")
      .on_click(() => this.openAccounts()).child(compact ? "Off" : "Enable account lookup →"));
    if (!providers.length) return root.child(mutedText(compact ? "—" : `${machine ?? "This Mac"} · No supported agents running`, c));
    for (const provider of providers) {
      const entry = (state.entries ?? []).find((item) => item.provider === provider.provider)
        ?? (state.entries ?? []).find((item) => item.provider === "Accounts");
      const windows = entry?.status === "ok" ? (entry.windows ?? []).filter((w) => w.scope !== "additional") : [];
      const error = entry?.status !== "ok" ? entry?.message : null;
      const message = error || (!windows.length ? entry?.note || (pending ? "Updating…" : "Usage unavailable") : "");
      const panel = v_flex().id(`analytics-sidebar-${provider.provider}`).w_full().gap(5)
        .cursor_pointer().on_click(() => this.openAccounts())
        .tooltip([provider.label, message, ...windows.map((w) => {
          const q = quotaPresentation(w, now, stale);
          return `${w.label}: ${q.used} · ${q.status || q.reset}`;
        })].filter(Boolean).join("\n"));
      panel.child(h_flex().gap(6).items_center()
        .child(agentIcon(`analytics-sidebar-icon-${provider.provider}`, provider.provider, c, { size: 14 }))
        .when(!compact, (el) => el.child(div().text_size(11.5).font_medium().child(provider.label))));
      if (compact) {
        const known = windows.filter((w) => Number.isFinite(w.usedPercent) && w.usedPercent >= 0);
        const peak = known.length ? Math.max(...known.map((w) => w.usedPercent)) : null;
        panel.child(div().text_size(10).text_color(stale ? c.dim : c.mutedForeground)
          .child(peak === null ? "—" : `${Math.round(peak)}%`));
      } else if (message) {
        panel.child(div().text_size(10.5).text_color(error ? c.destructive : c.dim)
          .child(error ? "Unavailable · open Accounts" : message));
      } else {
        for (const quotaWindow of windows) panel.child(this.sidebarQuota(quotaWindow, now, stale, c));
      }
      root.child(panel);
    }
    return root.when(!compact, (el) => el.child(div().text_size(9.5).text_color(c.dim)
      .tooltip(`${machine ?? "This Mac"} · ${caption}`).child(`${machine ?? "This Mac"} · ${caption}`)));
  }

  sidebarQuota(quotaWindow, now, stale, c) {
    const quota = quotaPresentation(quotaWindow, now, stale);
    const label = ({ "Session · 5 hours": "5h", "Weekly · 7 days": "7d", "Monthly credits": "Monthly" })[quotaWindow.label] || quotaWindow.label;
    const known = Number.isFinite(quotaWindow.usedPercent) && quotaWindow.usedPercent >= 0;
    const reset = quota.status === "Awaiting refresh" ? "Refresh due"
      : quota.resetAt ? `↻ ${accountDuration(Date.parse(quota.resetAt) - now)}` : "Reset unknown";
    return v_flex().w_full().gap(3)
      .tooltip(`${quotaWindow.label}: ${quota.used} · ${quota.reset}${quota.resetAt ? ` · ${formatTimestamp(quota.resetAt)}` : ""}${quota.status ? ` · ${quota.status}` : ""}`)
      .child(h_flex().w_full().gap(6).items_center().text_size(10.5)
        .child(div().text_color(c.mutedForeground).child(label))
        .child(div().text_color(c.text).font_medium().child(known ? `${Number(quotaWindow.usedPercent.toFixed(1))}%` : "—"))
        .child(div().flex_1())
        .child(div().text_color(c.dim).child(reset)))
      .child(div().w_full().h(4).rounded(2).bg(c.border).overflow_hidden()
        .accessibility_label(`${quotaWindow.label}: ${quota.used}`)
        .child(div().w(`${quota.fill}%`).h_full().rounded(2).bg(c[quota.tone])));
  }

  machineMenu(c) {
    const locked = this.saving || this.exporting || this.configDirty || this.editorDirty;
    const entries = new Map([[null, { name: null, layout: "ready" }]]);
    for (const entry of machines()) if (!entry.temporary) entries.set(entry.name, entry);
    if (!entries.has(this.machine)) entries.set(this.machine, { name: this.machine, layout: "unavailable" });
    const trigger = Button.new("analytics-machine-trigger").h(H.control).px(10).gap(G.sm)
      .border_1().border_color(c.border).rounded(R.control).bg(c.card).disabled(locked)
      .tooltip(locked ? "Save or reset settings before switching machines." : "Choose the machine for every Analytics page")
      .child(div().text_size(T.label).text_color(c.dim).child("Machine"))
      .child(div().max_w(160).truncate().text_color(c.text).child(this.machine ?? "This computer"))
      .child("⌄");
    const menu = Popover.new("analytics-machine-menu").trigger(trigger)
      .open(this.openFilter === "machine")
      .on_open_change((open, cx) => {
        this.openFilter = open && !locked ? "machine" : null;
        cx.notify();
      });
    if (this.openFilter === "machine") menu.content(v_flex().w(260).max_h(320).overflow_y_scrollbar()
      .p(G.xs).gap(2).rounded(R.card).bg(c.popover).border_1().border_color(c.border)
      .children([...entries.values()].map((entry, index) => Button.new(`analytics-machine-${index}`)
        .h(30).px(8).gap(G.sm).selected(entry.name === this.machine)
        .on_click((_event, cx) => { this.openFilter = null; this.selectMachine(entry.name, cx); cx.notify(); })
        .child(div().w(12).text_color(c.accent).child(entry.name === this.machine ? "✓" : ""))
        .child(div().flex_1().truncate().text_color(c.text).child(entry.name ?? "This computer"))
        .child(div().text_size(T.label).text_color(c.dim).child(entry.layout === "ready" ? "" : "Unavailable")))));
    return menu;
  }

  header(c) {
    const scan = this.snapshot?.scan;
    const updated = this.snapshot
      ? formatTimestamp(this.snapshot.lastCompletedScanAt || this.snapshot.lastScanAt || this.snapshot.generatedAt)
      : "";
    const preparing = !this.dashboard && (this.dashboardPending || this.dashboardQueued);
    const scanning = this.scanStatusLabel(scan);
    const status = this.loading ? "Refreshing…"
      : this.saving ? "Saving…"
        : preparing ? "Preparing…"
          : this.error ? (this.snapshot ? "Showing last snapshot" : "Unavailable")
            : this.dashboardError ? "Could not prepare dashboard"
              : scanning || (updated ? `Updated ${updated}` : "");
    const statusError = Boolean(this.error || this.dashboardError);
    return h_flex().w_full().flex_wrap().gap(G.md).items_center().justify_between()
      .child(h_flex().gap(G.md).items_center().flex_wrap()
        .child(pageTitle(this.showSettings ? "Settings" : "Analytics", c))
        .child(this.machineMenu(c)))
      .child(h_flex().flex_wrap().gap(G.sm).items_center()
        .when(Boolean(status), (el) => el.child(div().text_size(T.small)
          .text_color(statusError ? c.destructive : c.dim).child(status)))
        .child(button("analytics-refresh", "↻ Refresh", (_event, clickCx) => this.refresh(clickCx), c, {
          disabled: this.busy(),
          variant: "outline",
        }))
        .child(button("analytics-export", this.exporting ? "Exporting…" : "Export", (_event, clickCx) => this.exportMarkdown(clickCx), c, {
          disabled: !this.exportReady(),
          variant: "outline",
        }))
        .when(Boolean(this.snapshot), (el) => el.child(button(
          "analytics-settings",
          this.showSettings ? "Dashboard" : "Settings",
          (_event, clickCx) => {
            if (this.showSettings) {
              this.showSettings = false;
              clickCx.notify();
            } else {
              this.openSettings(clickCx);
            }
          },
          c,
          { variant: "outline" },
        )))
        .when(Boolean(this.overlay), (el) => el.child(iconButton("analytics-close", "×", "Close Analytics (Esc)",
          () => closeOverlay(this.overlay), c, { variant: "ghost" }))));
  }

  errorBanner(c) {
    return notice(c, {
      title: "Could not refresh analytics",
      body: this.error,
      action: button("analytics-retry", "Retry", (_event, clickCx) => this.refresh(clickCx), c, {
        disabled: this.busy(),
        variant: "outline",
      }),
    });
  }

  accountCard(c) {
    const enabled = !this.accounts.localOnly();
    const setting = card(c).gap(G.sm)
      .child(h_flex().w_full().gap(G.md).items_center().justify_between()
        .child(cardHeader("Account usage lookup", `CLI account limits on ${this.machine ?? "this Mac"} · Claude, Codex and Kiro.`, c))
        .child(toggleSwitch("analytics-account-usage", enabled,
          (checked, toggleCx) => this.accounts.setLocalOnly(!checked, toggleCx), c,
          { label: "Enable account usage lookup" })))
      .child(mutedText("Session analytics on the selected machine do not require account lookup. Account quotas are separate from token history.", c));
    if (!enabled) return setting.child(mutedText("Disabled · account credentials are not read and no account API requests are started.", c));
    const state = this.accounts.state();
    const entries = state.entries ?? [];
    const now = Date.now();
    const status = this.accounts.refreshStatus({ manual: true });
    const pending = status.kind === "pending";
    const offline = this.machine !== null && !machines().some((entry) => entry.name === this.machine && entry.layout === "ready");
    const stale = offline || Boolean(state.updatedAt) && now - state.updatedAt >= 10 * 60000;
    const cooldown = Math.max(0, (state.nextRefreshAt ?? 0) - now);
    const checked = state.updatedAt
      ? `Last checked ${formatTimestamp(new Date(state.updatedAt).toISOString())}${stale ? " · data may be outdated" : ""}`
      : "No account lookup completed yet";
    const failed = entries.filter((entry) => entry.status !== "ok");
    const updated = entries.length - failed.length;
    const age = state.updatedAt ? Math.max(0, now - state.updatedAt) : 0;
    const summary = offline ? "Machine unavailable · showing last known account data"
      : pending ? "Fetching latest account data…"
      : status.kind === "rate-limited" ? "The account API requested a pause before retrying."
      : status.kind === "not-ready" ? "The account helper is not ready yet."
      : state.updatedAt ? `Refresh complete · ${updated} updated${failed.length ? ` · Unavailable: ${failed.map((entry) => entry.provider).join(", ")}` : ""} · ${age < 60000 ? "just now" : `${accountDuration(age)} ago`}`
      : "Ready to refresh account usage";
    const label = pending ? `Refreshing… ${accountCountdown(now - state.startedAt)}`
      : status.kind === "rate-limited" ? `Retry in ${accountCountdown(status.waitMs)}`
      : status.kind === "not-ready" ? "Preparing…"
      : failed.length ? "↻ Retry accounts" : "↻ Refresh accounts";
    return v_flex().w_full().gap(G.lg)
      .child(setting)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
        .child(v_flex().gap(G.xs)
          .child(div().text_size(T.body).text_color(!pending && failed.length ? c.destructive : c.text).child(summary))
          .child(mutedText(checked, c))
          .child(mutedText(status.kind === "rate-limited" ? "Automatic refresh and manual retry resume after this countdown."
            : pending ? "Checking account usage. Existing values remain visible until the lookup finishes."
            : status.kind === "not-ready" ? "Check Analytics settings if the helper remains unavailable."
            : cooldown > 0 ? "Background checks run every 5 minutes. You can refresh manually now."
            : "Manual refresh checks the latest account data now", c)))
        .child(button("analytics-account-refresh", label, (_event, clickCx) => {
          this.accounts.refresh(clickCx, { manual: true });
          clickCx.notify();
        }, c, { variant: "outline", disabled: status.kind !== "ready" })))
      .when(entries.length === 0, (el) => el.child(inset(c)
        .child(bodyText(pending ? "Checking the accounts signed in to your CLIs…" : "Account usage will appear after the first lookup.", c))))
      .child(h_flex().w_full().flex_wrap().items_start().gap(G.lg)
        .children(entries.map((entry) => this.accountProviderCard(entry, now, stale, c))))
      .child(mutedText("Each bar shows used quota; the large number shows what remains. Low headroom = 80% used or more. Reset times use your local timezone. Quotas are separate limits, not token totals.", c));
  }

  accountProviderCard(entry, now, stale, c) {
    const windows = entry.status === "ok" ? entry.windows ?? [] : [];
    const main = windows.filter((window) => window.scope !== "additional");
    const additional = windows.filter((window) => window.scope === "additional");
    const panel = card(c).flex_basis(400).flex_grow(1)
      .child(h_flex().w_full().gap(G.sm).items_center().justify_between()
        .child(h_flex().gap(G.sm).items_center()
          .child(agentIcon(`analytics-account-icon-${entry.provider}`, entry.provider, c, { size: 20 }))
          .child(cardHeader(entry.provider, entry.plan ? `Plan · ${entry.plan}` : "Current CLI account", c)))
        .child(div().text_size(T.small).text_color(entry.status !== "ok" ? c.destructive : c.dim)
          .child(entry.status !== "ok" ? "Unavailable" : stale ? "Last known usage" : "Account quota")));
    if (entry.status !== "ok") return panel.child(bodyText(entry.message, c));
    return panel
      .when(Boolean(entry.note), (el) => el.child(bodyText(entry.note, c)))
      .children(main.map((window) => this.accountWindow(window, now, stale, c)))
      .when(main.length === 0 && !entry.note, (el) => el.child(mutedText("Main quota windows were not provided by the account API.", c)))
      .when(additional.length > 0, (el) => el
        .child(metaLabel(entry.provider === "Kiro" ? "Additional credits" : "Model & feature limits", c))
        .children(additional.map((window) => this.accountWindow(window, now, stale, c, true))));
  }

  accountWindow(window, now, stale, c, compact = false) {
    const quota = quotaPresentation(window, now, stale);
    const color = c[quota.tone];
    return inset(c).gap(G.sm)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
        .child(fieldLabel(window.label, c))
        .when(Boolean(quota.status), (el) => el.child(div().text_size(T.small).text_color(color).child(quota.status))))
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_end().justify_between()
        .child(h_flex().gap(G.xs).items_baseline()
          .child(div().text_size(compact ? 17 : T.metric).font_semibold().text_color(c.text).child(quota.remaining))
          .child(mutedText("remaining", c)))
        .child(bodyText(quota.used, c)))
      .when(Number.isFinite(window.usedCredits) && Number.isFinite(window.limitCredits), (el) => el
        .child(bodyText(`${window.usedCredits.toFixed(2)} / ${window.limitCredits.toFixed(2)} credits used`, c)))
      .child(div().w_full().h(6).rounded(3).bg(c.border).overflow_hidden()
        .accessibility_label(`${window.label}: ${quota.used}`)
        .child(div().w(`${quota.fill}%`).h_full().rounded(3).bg(color)))
      .child(v_flex().gap(2)
        .child(bodyText(quota.reset, c))
        .when(Boolean(quota.resetAt), (el) => el.child(mutedText(formatTimestamp(quota.resetAt), c))));
  }

  initialState(c) {
    const loading = this.loading || !this.runtimeReady;
    const progress = this.scanProgress;
    const total = Number(progress?.total) || 0;
    const processed = Number(progress?.processed) || 0;
    const file = typeof progress?.file === "string" ? progress.file : "";
    const decodedBytes = Number(progress?.decodedBytes ?? progress?.bytes) || 0;
    return stateCard(c, {
      tone: loading ? c.accent : c.destructive,
      title: loading ? `Loading analytics · ${this.machine ?? "This computer"}` : "Analytics needs its collector",
      body: loading
        ? [
          total > 0 ? `Scanning ${formatInt(processed)} of ${formatInt(total)} files` : null,
          decodedBytes > 0 ? `${formatBytes(decodedBytes)} decoded` : null,
        ].filter(Boolean).join(" · ") || null
        : (this.error || "The collector did not return a snapshot yet."),
      detail: loading && file ? file : null,
      action: loading || this.busy() ? null : button("analytics-initial-retry", "Retry", (_event, clickCx) => this.refresh(clickCx), c, {
        variant: "primary",
      }),
    });
  }

  dashboardErrorBanner(c) {
    return notice(c, {
      title: "Could not prepare the dashboard",
      body: this.dashboardError,
      action: button("analytics-dashboard-retry", "Retry", (_event, clickCx) => {
        this.scheduleDashboard(clickCx, { force: true });
        clickCx.notify();
      }, c, { disabled: Boolean(this.dashboardPending), variant: "outline" }),
    });
  }

  dashboardView(c) {
    const derived = this.dashboard;
    if (!derived) {
      const retry = (id, primary) => button(id, "Retry", (_event, clickCx) => {
        this.scheduleDashboard(clickCx, { force: true });
        clickCx.notify();
      }, c, { disabled: Boolean(this.dashboardPending), variant: primary ? "primary" : "outline" });
      if (this.dashboardError) {
        return stateCard(c, {
          tone: c.destructive,
          title: "Could not prepare analytics",
          body: this.dashboardError,
          action: retry("analytics-prepare-retry", true),
        });
      }
      return stateCard(c, {
        tone: c.accent,
        title: "Preparing analytics",
        action: retry("analytics-prepare-retry", false),
      });
    }
    const { config, rowCount, range, lifetime, peak, streaks, heatmap, leaders, selectedDay, selectedTotals, selectedTop, years } = derived;
    if (this.page !== "history" && derived.operations) return this.operationsView(c, derived);

    return v_flex().w_full().gap(G.lg)
      .child(mutedText("All-history activity below. Period and facet filters apply to the Model usage section; Overview and Sessions apply them to every usage metric.", c))
      .child(this.metricStrip(c, lifetime, peak, streaks))
      .when(rowCount === 0, (el) => el.child(this.emptyNotice(c, config)))
      .child(this.sectionHeader("Token usage", c))
      .child(this.heatmapCard(c, config, heatmap, selectedDay))
      .child(this.tokenDetailCard(c, heatmap, selectedDay, derived.today, selectedTotals, selectedTop, lifetime, derived.lifetimeTop))
      .child(this.sectionHeader("Model usage", c))
      .child(this.filtersBar(c, config, range, derived.facets, years))
      .when(Boolean(derived.modelSeries?.weeks?.length), (el) => el.child(this.modelChartCard(c, derived.modelSeries)))
      .child(this.leaderboardCard(c, leaders, range));
  }

  fleetCard(c) {
    const activeSpace = spaces().find((space) => space.active)?.id;
    const scope = this.fleetScope === "space" ? activeSpace : null;
    const fleet = fleetSnapshot(agents(), terminals(), spaces(), machines().filter((entry) => entry.name === this.machine), scope, this.machine);
    const attention = fleet.rows.filter((agent) => agent.status === "blocked" || agent.status === "done");
    const selected = this.fleetScope === "attention" ? attention : fleet.rows;
    const rows = selected.slice(0, this.showAllAgents ? 50 : 5);
    const labels = { working: "Working", blocked: "Needs input", done: "Finished · review", idle: "Idle", unknown: "Unknown" };
    return card(c).gap(G.sm)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).justify_between().items_center()
        .child(cardHeader("Live agents", `${fleet.counts.working} working · ${fleet.counts.blocked} need input · ${fleet.counts.done} finished · ${fleet.counts.idle} idle`, c))
        .child(segmented("analytics-fleet-scope", [{ key: "all", label: "All spaces" }, { key: "attention", label: "Needs attention" }, { key: "space", label: "This space" }], this.fleetScope, (scope) => { this.fleetScope = scope; }, c)))
      .children(rows.map((agent) => h_flex().id(`analytics-agent-${agent.address}`).w_full().gap(G.sm).items_center().py(5)
        .cursor_pointer().hover((style) => style.bg(c.subtle))
        .on_click(() => {
          if (this.overlay) closeOverlay(this.overlay);
          run("agent.focus", { terminal: agent.address });
        })
        .child(div().w(120).flex_none().text_size(T.small).text_color(agent.status === "blocked" ? c.destructive : agent.status === "done" ? c.done : c.dim).child(labels[agent.status]))
        .child(agentIcon(`analytics-live-icon-${agent.address}`, agent.app, c, { program: agent.program }))
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(T.body).truncate().child(agent.name))
          .child(div().text_size(T.label).text_color(c.dim).truncate().child(`${agent.machine || "This computer"} / ${agent.space}${agent.parentName ? ` · child of ${agent.parentName}` : ""}${agent.children ? ` · ${agent.children} child agents` : ""}`)))
        .child(mutedText("Open →", c))))
      .when(!rows.length, (el) => el.child(mutedText(this.fleetScope === "attention" ? "No agents currently need input or review." : "No agents reported in this scope.", c)))
      .when(selected.length > 5, (el) => el.child(button("analytics-fleet-more", this.showAllAgents ? "Show fewer" : `Show more (${selected.length})`, (_event, cx) => { this.showAllAgents = !this.showAllAgents; cx.notify(); }, c, { variant: "ghost" })))
      .when(selected.length > 50 && this.showAllAgents, (el) => el.child(mutedText("Showing the first 50; narrow to this space or needs attention.", c)))
      .when(fleet.unavailable.length > 0, (el) => el.child(mutedText(`Unavailable/loading machines: ${fleet.unavailable.map((machine) => machine.name || "This computer").join(", ")}. Agent counts may be incomplete.`, c)))
      .child(mutedText("Live status from connected Herdr cores. Finished is not a quality score. Historical usage below covers session files on the selected machine only.", c));
  }

  drilldown(field, value, cx) {
    this.filters[field] = value;
    this.page = "sessions";
    this.selectedSession = null;
    this.scheduleDashboard(cx, { force: true });
    cx.notify();
  }

  operationsView(c, data) {
    const op = data.operations;
    const coverage = op.coverage;
    const t = op.totals;
    const old = op.previous;
    const range = data.range;
    const difference = t.total - old.total;
    const comparison = !range.previous ? "No comparison for all time"
      : !op.baselineCovered ? "Baseline incomplete: earlier local history is unavailable"
      : `${difference >= 0 ? "+" : ""}${formatCompact(difference)} (${op.change.label}) vs ${range.previous.start}–${range.previous.end}`;
    const metrics = [
      ["Tokens", formatCompact(t.total), data.includeCache ? "includes cache reads + writes" : "cache excluded"],
      ["New input", formatCompact(t.input + t.cacheWrite), "uncached input + cache writes"],
      ["Output", formatCompact(t.output), "reasoning is included"],
      ["Input reuse", t.reusePct === null ? "—" : `${t.reusePct}%`, "cache reads / all input tokens"],
      ["Sessions", formatInt(t.sessions), `${op.projectCount} projects · ${formatInt(t.messages)} recorded messages`],
    ];
    const content = v_flex().w_full().gap(G.lg)
      .child(this.filtersBar(c, data.config, range, data.facets, data.years))
      .when(Boolean(this.dashboardPending), (el) => el.child(mutedText("Updating filters… showing the previous selection until ready.", c)))
      .child(mutedText(`${range.label} · ${range.start || op.firstDay || "No history"}–${range.end} · ${this.machine ?? "This computer"} session data`, c))
      .child(card(c).child(h_flex().w_full().flex_wrap().gap(G.lg).children(metrics.map(([label, value, note]) =>
        v_flex().flex_1().min_w(145).gap(G.xs).child(metaLabel(label, c))
          .child(div().text_size(T.metric).font_semibold().child(value)).child(mutedText(note, c))))))
      .child(mutedText(`${comparison}${range.previous ? ". Calendar-day totals; the current day is incomplete. Earlier records do not guarantee complete coverage." : ""}`, c))
      .child(card(c).gap(G.xs)
        .child(h_flex().w_full().flex_wrap().gap(G.sm).justify_between()
          .child(cardHeader("Data coverage", `Last scan ${formatTimestamp(coverage.lastScanAt) || "not completed"}${coverage.partial ? " · scan still in progress; totals are partial" : ""}`, c))
          .child(button("analytics-coverage-settings", "Sources", (_event, cx) => this.openSettings(cx), c, { variant: "ghost" })))
        .child(h_flex().flex_wrap().gap(G.md).items_center().children(coverage.sources.map((source, index) =>
          h_flex().gap(G.xs).items_center()
            .child(sourceIcon(`analytics-coverage-icon-${index}`, source.name, data.config, c))
            .child(mutedText(source.status, c)))))
        .child(mutedText(`${coverage.errors === null ? "Unknown scan error count" : `${coverage.errors} scan errors`} · ${coverage.warnings} warnings · ${coverage.unknownProjects} rows without a project · ${coverage.unknownModels} rows without a model`, c)));
    if (this.page === "sessions") return content.child(this.sessionsCard(c, op));
    if (range.previous && op.drivers.length) content.child(card(c).gap(G.sm)
      .child(cardHeader("What changed?", "Largest project changes in recorded tokens. Click a project to inspect its sessions.", c))
      .children(op.drivers.map((entry) => h_flex().id(`analytics-driver-${entry.name}`).w_full().gap(G.sm).justify_between().py(4)
        .cursor_pointer().hover((style) => style.bg(c.subtle))
        .on_click((_event, cx) => this.drilldown("project", entry.name, cx))
        .child(div().flex_1().min_w(0).truncate().tooltip(entry.name).text_size(T.body).child(projectName(entry.name)))
        .child(mutedText(`${formatCompact(entry.previous)} → ${formatCompact(entry.current)} (${entry.delta >= 0 ? "+" : ""}${formatCompact(entry.delta)})`, c)))));
    const groupCard = (title, entries, field, count) => card(c).gap(G.sm)
      .child(cardHeader(title, `Ranked by recorded tokens · showing ${entries.length}${count ? ` of ${count}` : ""} · click to inspect sessions`, c))
      .when(!entries.length, (el) => el.child(mutedText("No recorded usage matches these filters.", c)))
      .children(entries.map((entry) => h_flex().id(`analytics-group-${field}-${entry.name}`).w_full().gap(G.sm).py(5).items_center()
        .cursor_pointer().hover((style) => style.bg(c.subtle))
        .on_click((_event, cx) => this.drilldown(field, entry.name, cx))
        .child(h_flex().flex_1().min_w(0).items_center()
          .child(field === "project"
            ? div().truncate().text_size(T.body).tooltip(entry.name).child(projectName(entry.name))
            : sourceIcon(`analytics-usage-icon-${entry.name}`, entry.name, data.config, c)))
        .child(mutedText(`${entry.sessions} sessions · ${entry.reusePct === null ? "—" : `${entry.reusePct}%`} input reuse`, c))
        .child(div().w(95).text_right().text_size(T.body).child(`${formatCompact(entry.total)} · ${t.total > 0 ? Math.round(entry.total / t.total * 100) : 0}%`))));
    return content.child(groupCard("Usage by agent tool", op.harnesses, "source"))
      .child(groupCard("Usage by project", op.projects, "project", op.projectCount))
      .child(this.leaderboardCard(c, data.leaders, range))
      .child(mutedText("Token volume and cache reuse describe workload, not task quality or money saved. This data does not establish success rates, latency or tool failure rates.", c));
  }

  sessionsCard(c, op) {
    const selected = op.sessions.find((session) => session.key === this.selectedSession);
    const panel = card(c).gap(G.sm)
      .child(cardHeader("Sessions to inspect", `Top ${op.sessions.length} of ${op.sessionCount} by tokens in the selected period. Choose a row for its breakdown.`, c))
      .when(!op.sessions.length, (el) => el.child(mutedText("No recorded sessions match these filters.", c)))
      .child(v_flex().max_h(360).overflow_y_scrollbar().children(op.sessions.map((session) =>
        h_flex().id(`analytics-session-${session.key}`).w_full().py(6).gap(G.sm).items_center().cursor_pointer()
          .when(session.key === this.selectedSession, (el) => el.bg(c.selected))
          .hover((style) => style.bg(c.subtle))
          .on_click((_event, cx) => { this.selectedSession = session.key; cx.notify(); })
          .child(sourceIcon(`analytics-session-icon-${session.key}`, session.harness, this.dashboard?.config ?? {}, c))
          .child(v_flex().flex_1().min_w(0)
            .child(div().text_size(T.body).truncate().tooltip(session.projects.join("\n")).child(session.projects.map(projectName).join(", ")))
            .child(div().text_size(T.label).text_color(c.dim).truncate().child(`${session.lastDay} · ${session.id}`)))
          .child(mutedText(`${formatCompact(session.total)} tokens · ${formatInt(session.messages)} messages`, c)))));
    if (selected) panel.child(inset(c).gap(G.sm)
      .child(cardHeader("Selected session", selected.id, c))
      .child(h_flex().gap(G.xs).items_center()
        .child(sourceIcon("analytics-selected-session-icon", selected.harness, this.dashboard?.config ?? {}, c))
        .child(mutedText(`Observed ${selected.firstDay}–${selected.lastDay} · ${selected.projects.join(", ")}`, c)))
      .child(mutedText(`Uncached input ${formatInt(selected.input)} · output ${formatInt(selected.output)} · cache reads ${formatInt(selected.cacheRead)} · cache writes ${formatInt(selected.cacheWrite)}`, c))
      .child(mutedText(`Reasoning ${formatInt(selected.reasoning)} (already in output) · input reuse ${selected.reusePct === null ? "—" : `${selected.reusePct}%`}`, c))
      .child(mutedText("Top models by tokens (up to 8)", c))
      .children(selected.models.map((model) => h_flex().w_full().justify_between().gap(G.sm)
        .child(bodyText(model.name, c)).child(mutedText(`${formatCompact(model.total)} tokens`, c)))));
    return panel;
  }

  sectionHeader(title, c) {
    return h_flex().w_full().items_center().gap(G.md).pt(G.sm)
      .child(div().text_size(T.card).font_semibold().text_color(c.text).child(title))
      .child(div().flex_1().h(1).bg(c.border));
  }

  filtersBar(c, config, _range, facets, years) {
    const active = Object.values(this.filters).some((value) => value !== "all");

    // A plain toolbar row: period first, then facet filters. No card chrome,
    // so it reads as page navigation instead of a floating section.
    return h_flex().w_full().flex_wrap().gap(G.sm).items_center()
      .child(segmented("ins-period", [
        { key: "today", label: "Today" },
        { key: "week", label: "Week" },
        { key: "month", label: "Month" },
        { key: "year", label: "Year" },
        { key: "all", label: "All" },
      ], this.period, (key, changeCx) => this.setPeriod(key, changeCx), c))
      .when(this.period === "year", (el) => el.child(h_flex().gap(G.xs).items_center()
        .child(iconButton("ins-year-older", "‹", "Older year", (_event, clickCx) => { this.setYear(1, clickCx); clickCx.notify(); }, c))
        .child(div().min_w(36).text_center().text_size(T.body).font_medium().text_color(c.text).child(String(this.year)))
        .child(iconButton("ins-year-newer", "›", "Newer year", (_event, clickCx) => { this.setYear(-1, clickCx); clickCx.notify(); }, c, {
          color: this.year >= years[0] ? c.dim : c.mutedForeground,
        }))))
      .child(this.filterMenu("provider", "Provider", this.filters.provider, facets.provider, config, c, (value, pickCx) => { this.filters.provider = value; this.scheduleDashboard(pickCx, { force: true }); }))
      .child(this.filterMenu("model", "Model", this.filters.model, facets.model, config, c, (value, pickCx) => { this.filters.model = value; this.scheduleDashboard(pickCx, { force: true }); }))
      .child(this.filterMenu("source", "Agent tool", this.filters.source, facets.source, config, c, (value, pickCx) => { this.filters.source = value; this.scheduleDashboard(pickCx, { force: true }); }))
      .child(this.filterMenu("project", "Project", this.filters.project, facets.project, config, c, (value, pickCx) => { this.filters.project = value; this.scheduleDashboard(pickCx, { force: true }); }))
      .when(active, (el) => el.child(button("ins-clear-filters", "Clear filters", (_event, clickCx) => {
        this.filters = { source: "all", project: "all", provider: "all", model: "all" };
        this.scheduleDashboard(clickCx, { force: true });
        clickCx.notify();
      }, c, { variant: "ghost" })));
  }

  filterMenu(field, label, value, facet, config, c, onPick) {
    const selected = selectedFacet(facet, value, field, config);
    const id = `ins-${field}-filter`;
    const active = value !== "all";
    const trigger = Button.new(`ins-${field}-trigger`).h(H.control).px(8).gap(G.sm).items_center().rounded(R.control)
      .border_1().border_color(active ? c.ring : c.border).bg(c.card).cursor_pointer()
      .hover((style) => style.bg(c.subtle))
      .focus((style) => style.border_color(c.ring))
      .accessibility_label(`${label}: ${selected.label}`)
      .child(div().text_size(T.label).font_medium().text_color(c.dim).child(label))
      .child(div().max_w(132).truncate().text_size(T.body).text_color(c.text).child(selected.label))
      .child(div().text_size(11).text_color(c.dim).child("⌄"));

    const menu = Popover.new(id).trigger(trigger)
      .open(this.openFilter === id)
      .on_open_change((open, changeCx) => {
        this.openFilter = open ? id : null;
        // Menu data is prepared in this event, never in the 50 ms render pass.
        this.openOptions = open ? buildFacetOptions(field, facet, config) : null;
        changeCx.notify();
      });
    // Closed menus build no option elements; only the trigger is rendered.
    if (this.openFilter === id && this.openOptions) {
      menu.content(this.filterMenuContent(field, value, this.openOptions, c, onPick));
    }
    return menu;
  }

  filterMenuContent(field, value, options, c, onPick) {
    return v_flex().w(240).max_h(320).overflow_y_scrollbar().p(G.xs).gap(2).rounded(R.card)
      .bg(c.popover).border_1().border_color(c.border)
      .child(div().px(8).py(4).text_size(T.label).text_color(c.dim).child("Reference totals · all-time tokens on this machine"))
      .children(options.options.map((option, index) => {
        const selected = option.value === value;
        return Button.new(`ins-${field}-option-${index}`)
          .h(28).px(8).gap(G.sm).items_center().rounded(R.control)
          .selected(selected)
          .set_position(index + 1, options.options.length)
          .cursor_pointer()
          .when(selected, (el) => el.bg(c.selected))
          .when(!selected, (el) => el.hover((style) => style.bg(c.subtle)))
          .focus((style) => style.bg(c.selected))
          .accessibility_label(option.label)
          .on_click((_event, clickCx) => {
            this.openFilter = null;
            this.openOptions = null;
            onPick(option.value, clickCx);
            clickCx.notify();
          })
          .child(div().w(12).text_size(10).text_color(c.accent).child(selected ? "✓" : ""))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().text_size(T.body).text_color(c.text).truncate().tooltip(option.tooltip || option.label).child(option.label))
            .when(Boolean(option.detail), (el) => el.child(div().text_size(T.label).text_color(c.dim).truncate().child(option.detail))))
          .child(div().text_size(T.label).text_color(c.dim).child(option.meta ?? ""));
      }))
      .when(options.truncated, (el) => el.child(div().p(G.sm).text_size(T.label).text_color(c.dim)
        .child(`Showing top ${MAX_FACET_OPTIONS} by tokens.`)));
  }

  emptyNotice(c, config) {
    const roots = [];
    for (const source of config.sources ?? []) {
      if (source?.enabled === false) continue;
      for (const root of source.roots ?? []) roots.push(root);
    }
    return card(c).gap(G.sm)
      .child(h_flex().items_center().gap(G.sm)
        .child(div().size(8).flex_none().rounded_full().bg(c.accent))
        .child(div().text_size(T.card).font_semibold().text_color(c.text).child("No usage found yet")))
      .child(bodyText("Enable a source and check its roots. Analytics only reads harness session files on the selected machine and never stores prompts or code.", c))
      .when(roots.length > 0, (el) => el.child(v_flex().gap(2)
        .children(roots.slice(0, 4).map((root) => mutedText(root, c)))))
      .child(h_flex().pt(G.xs)
        .child(button("ins-empty-settings", "Open settings", (_event, clickCx) => this.openSettings(clickCx), c, { variant: "outline" })));
  }

  metricStrip(c, lifetime, peak, streaks) {
    const stats = [
      {
        label: "Lifetime tokens",
        value: formatCompact(lifetime.total),
        note: `${formatInt(lifetime.sessions)} sessions · all time`,
        tooltip: `${formatInt(lifetime.total)} tokens${lifetime.reasoning ? ` · ${formatInt(lifetime.reasoning)} reasoning inside output` : ""}`,
      },
      {
        label: "Peak day",
        value: peak.day ? formatCompact(peak.tokens) : "—",
        note: peak.day ? dayLabel(peak.day) : "No activity yet",
        tooltip: peak.day ? `${formatInt(peak.tokens)} tokens on ${dayLabel(peak.day)}` : "No activity yet",
      },
      {
        label: "Longest task",
        value: formatDuration(lifetime.longestTaskMs),
        note: lifetime.longestTaskMs > 0 ? "Observed span" : "Not reported",
        tooltip: lifetime.longestTaskMs > 0 ? `${formatInt(lifetime.longestTaskMs)} ms observed` : "Unknown task duration",
      },
      {
        label: "Longest streak",
        value: `${formatInt(streaks.longest)}D`,
        tooltip: `${formatInt(streaks.longest)} consecutive active days`,
      },
      {
        label: "Current streak",
        value: `${formatInt(streaks.current)}D`,
        color: streaks.current > 0 ? c.accent : c.text,
        tooltip: `${formatInt(streaks.current)} current consecutive active days`,
      },
    ];

    // One summary band with hairline dividers instead of five separate boxes.
    const stat = (item, divided) => v_flex().flex_1().min_w(0).gap(2)
      .when(divided, (el) => el.border_l(1).border_color(c.border).pl(G.lg))
      .child(metaLabel(item.label, c))
      .child(div().text_size(T.metric).font_semibold().text_color(item.color ?? c.text).truncate()
        .tooltip(item.tooltip).child(item.value))
      .when(Boolean(item.note), (el) => el.child(mutedText(item.note, c)));
    const row = (items) => h_flex().w_full().items_start()
      .children(items.map((item, index) => stat(item, index > 0)));

    if ((this.width || 960) >= 860) return card(c).child(row(stats));
    const perRow = (this.width || 960) >= 560 ? 3 : 2;
    const band = card(c);
    for (let start = 0; start < stats.length; start += perRow) {
      band.child(row(stats.slice(start, start + perRow)));
    }
    return band;
  }

  heatmapCard(c, config, heatmap, selectedDay) {
    const dark = isDarkTheme(c);
    const palette = PALETTES.includes(config.palette) ? config.palette : "blue";
    const metrics = heatmapMetrics(this.width, heatmap.weeks.length, Number(settings().zoom) || 1, this.heatmapRowPx);
    const cell = metrics.cell;
    const weekWidth = metrics.weekWidth;
    // Too narrow for every week: draw only the newest ones that fit, rather than
    // overflowing the row (an overflowing flex child is not reliably end-aligned,
    // which hid the current week).
    const shown = fitHeatmapWeeks(heatmap, metrics.fitWeeks);
    const contentWidth = metrics.contentWidth - (heatmap.weeks.length - shown.weeks.length) * weekWidth;
    // A one-week leading partial month is narrow, so keep the span but omit text that would wrap.
    const months = shown.months.map((month) => div().w(month.span * weekWidth).flex_none()
      .text_size(9.5).text_color(c.dim)
      .when(month.span >= 2, (el) => el.whitespace_nowrap().child(month.label)));
    const weekLabels = weekdayLabels(heatmap.weekStartsOn).map((label) => div().h(cell).text_size(9)
      .text_color(c.dim).child(label));

    const cellElement = (dayCell) => {
      const color = dayCell.future
        ? c.muted
        : dayCell.level > 0 ? heatColor(dayCell.level, palette, dark) : c.muted;
      return div().id(`ins-cell-${dayCell.date}`).size(cell).flex_none().rounded(2).bg(color)
        .opacity(dayCell.future ? 0.3 : 1)
        .when(!dayCell.future, (el) => el.cursor_pointer()
          .hover((style) => style.opacity(0.8))
          .on_click((_event, clickCx) => {
            this.selectedDay = dayCell.date;
            this.scheduleDashboard(clickCx, { force: true });
            clickCx.notify();
          })
          .tooltip(dayCell.tooltip ?? ""))
        .when(dayCell.date === selectedDay, (el) => el.border_1().border_color(c.ring));
    };
    const weekElements = shown.weeks.map((week) => v_flex().gap(CELL_GAP).children(week.days.map(cellElement)));
    const grid = v_flex().w(contentWidth).flex_none().gap(G.xs)
      .child(h_flex().h(15).children([
        div().w(DAY_LABEL_WIDTH).flex_none(),
        ...months,
      ]))
      .child(h_flex().gap(CELL_GAP).items_start()
        .child(v_flex().w(DAY_LABEL_WIDTH).flex_none().gap(CELL_GAP).children(weekLabels))
        .child(h_flex().gap(CELL_GAP).children(weekElements)));

    // The legend spans the card's inner width, the same as the grid's row, so
    // its measured width is what the grid is fitted to.
    const legend = h_flex().id("ins-heat-legend").w_full().flex_wrap().gap(G.sm).items_center().justify_end()
      .on_size_change((size, sizeCx) => {
        if (Math.abs((this.heatmapRowPx || 0) - size.width) < 1) return;
        this.heatmapRowPx = size.width;
        sizeCx.notify();
      })
      .child(mutedText("Less", c))
      .children([0, 1, 2, 3, 4].map((level) => div().size(10).rounded(2)
        .bg(level === 0 ? c.muted : heatColor(level, palette, dark))))
      .child(mutedText("More", c))
      .child(mutedText(`${formatCompact(heatmap.windowTotal)} in window`, c));

    return card(c).gap(G.md)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
        .child(cardHeader("Tokens History", null, c))
        .child(segmented("ins-heat-mode", [
          { key: "daily", label: "Daily" },
          { key: "weekly", label: "Weekly" },
          { key: "cumulative", label: "Cumulative" },
        ], this.heatmapMode, (key, changeCx) => {
          this.heatmapMode = key;
          this.scheduleDashboard(changeCx, { force: true });
        }, c)))
      // The latest data matters most: a narrow view draws only the newest weeks
      // (fitHeatmapWeeks), so the grid always fits and is simply centered.
      .child(h_flex().w_full().overflow_hidden().justify_center().child(grid))
      .child(legend);
  }

  tokenDetailCard(c, heatmap, selectedDay, today, selectedTotals, selectedTop, lifetime, lifetimeTop) {
    const hitTooltip = (totals) => `${formatInt(totals.cacheRead)} cache reads of ${formatInt(totals.input + totals.cacheRead)} input-side tokens`;
    const column = (label, totals, top, divided) => v_flex().flex_1().min_w(0).gap(G.sm)
      .when(divided, (el) => el.border_l(1).border_color(c.border).pl(G.lg))
      .child(metaLabel(label, c))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.md).items_start()
        .child(statCell("Input", formatCompact(totals.input), c, { tooltip: `${formatInt(totals.input)} input tokens` }))
        .child(statCell("Output", formatCompact(totals.output), c, {
          tooltip: `${formatInt(totals.output)} output tokens · reasoning ${formatInt(totals.reasoning)}`,
        }))
        .child(statCell("Cache hit rate", formatHitRate(totals.input, totals.cacheRead), c, { tooltip: hitTooltip(totals) }))
        .child(statCell("Top model", top?.name ?? "—", c, top
          ? { tooltip: `${top.name} · ${top.sublabel}` }
          : { tooltip: "No model usage" })));

    const dayHeading = selectedDay === today ? "Today" : dayLabel(selectedDay, { weekday: true });
    return card(c)
      .child(h_flex().w_full().items_start().gap(G.lg)
        .child(column("All time", lifetime, lifetimeTop, false))
        .child(column(dayHeading, selectedTotals, selectedTop, true)));
  }

  modelChartCard(c, series) {
    const weeks = series.weeks;
    const maxTotal = series.maxTotal || 0;
    const colors = new Map(series.models.map((name, index) => [name, modelChartColor(name, index)]));

    const bar = (week) => v_flex().flex_1().min_w(0).h(CHART_HEIGHT).justify_end()
      .tooltip(`Week of ${dayLabel(week.start)} · ${formatCompact(week.total)} tokens`)
      .when(week.total > 0 && maxTotal > 0, (el) => el.child(
        v_flex().w_full().flex_none().h(Math.max(2, Math.round((week.total / maxTotal) * CHART_HEIGHT)))
          .children(week.segments.map((segment) => div().w_full().flex_grow(Math.max(0.001, segment.tokens))
            .bg(colors.get(segment.name) ?? OTHER_CHART_COLOR)
            .tooltip(`${segment.name} · ${formatCompact(segment.tokens)} tokens`))),
      ));

    const axisLabel = (text) => div().text_size(9).text_color(c.dim).child(text);
    const labelStep = Math.ceil(weeks.length / 6);
    const legend = h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.xs).items_center()
      .children(series.models.map((name) => h_flex().items_center().gap(G.xs)
        .child(div().size(8).flex_none().rounded_full().bg(colors.get(name) ?? OTHER_CHART_COLOR))
        .child(div().max_w(180).truncate().text_size(T.label).text_color(c.mutedForeground).tooltip(name).child(name))));

    return card(c).gap(G.md)
      .child(cardHeader(
        "Top models",
        `${weeks.length} weeks · ${formatCompact(series.windowTotal)} tokens · ${series.includeCache ? "cache included" : "cache excluded"}`,
        c,
      ))
      .when(maxTotal === 0, (el) => el.child(div().py(G.lg).text_size(T.body).text_color(c.mutedForeground)
        .child("No model usage in this window.")))
      .when(maxTotal > 0, (el) => el.child(v_flex().w_full().gap(G.sm)
        .child(h_flex().w_full().gap(G.sm).items_end()
          .child(v_flex().w(28).flex_none().h(CHART_HEIGHT).justify_between().children([
            axisLabel(formatCompact(maxTotal)),
            axisLabel(formatCompact(maxTotal / 2)),
            axisLabel("0"),
          ]))
          .child(h_flex().flex_1().min_w(0).gap(CELL_GAP).items_end().children(weeks.map(bar))))
        .child(h_flex().w_full().gap(G.sm)
          .child(div().w(28).flex_none())
          .child(h_flex().flex_1().min_w(0).gap(CELL_GAP).children(weeks.map((week, index) => div()
            .flex_1().min_w(0).text_size(9).text_color(c.dim).whitespace_nowrap()
            .child(index % labelStep === 0 ? dayLabel(week.start, { year: false }) : "")))))
        .child(legend)));
  }

  leaderboardCard(c, leaders, range) {
    const entries = leaders.entries;
    const half = Math.ceil(entries.length / 2);
    const left = entries.slice(0, half);
    const right = entries.slice(half);

    const changeLabel = (entry) => {
      if (entry.change.kind === "none") return "—";
      if (entry.change.kind === "up") return `↑${entry.change.label}`;
      if (entry.change.kind === "down") return `↓${entry.change.label}`;
      return entry.change.label;
    };

    const row = (entry) => {
      const logo = usageLogo(entry.name, entry.provider);
      return h_flex().w_full().items_center().gap(G.sm).py(G.sm)
        .border_b(1).border_color(c.border)
        .child(div().w(20).text_size(T.body).text_color(c.dim).child(`${entry.rank}.`))
        .child(h_flex().size(26).flex_none().rounded(R.control).bg(c.secondary).border_1().border_color(c.border)
          .items_center().justify_center()
          .child(logo
            ? svg(`mods/analytics/logos/${logo}`).size(14).text_color(c.mutedForeground)
            : div().text_size(9).font_semibold().text_color(c.mutedForeground).child(initials(entry.name, 1))))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(12).font_medium().text_color(c.text).truncate().tooltip(entry.name).child(entry.name))
          .child(div().text_size(10).text_color(c.dim).truncate().child(`by ${entry.sublabel}`)))
        .child(v_flex().items_end().gap(1)
          .child(div().text_size(12).font_semibold().text_color(c.text).tooltip(`${formatInt(entry.tokens)} tokens`)
            .child(`${formatCompact(entry.tokens)} tokens`))
          .child(div().text_size(T.small).text_color(changeColor(entry.change, c))
            .tooltip(entry.change.kind === "none" ? "No previous period" : `Previous ${formatInt(entry.previous ?? 0)} tokens`)
            .child(changeLabel(entry))));
    };

    const empty = v_flex().w_full().items_center().gap(G.sm).p(G.lg)
      .child(div().text_size(12).font_medium().text_color(c.text).child("No usage in this period"))
      .child(bodyText("Try All time, another year, or clear the filters.", c))
      .child(button("ins-leaders-all", "Show all time", (_event, clickCx) => {
        this.setPeriod("all", clickCx);
        clickCx.notify();
      }, c, { variant: "outline" }));

    const column = (items) => v_flex().flex_basis(LEADERBOARD_COLUMN_BASIS).flex_grow(1).min_w(0).gap(0)
      .children(items.map((entry) => row(entry)));

    return card(c).gap(G.md)
      .child(cardHeader(
        "Model Usage",
        `${range.label} · ${formatCompact(leaders.totalTokens)} tokens · ${formatInt(leaders.totalSessions)} sessions`,
        c,
      ))
      .when(entries.length === 0, (el) => el.child(empty))
      .when(entries.length > 0, (el) => el.child(h_flex().w_full().flex_wrap().items_start().gap_x(G.xl)
        .child(column(left))
        .when(right.length > 0, (inner) => inner.child(column(right)))))
      .when(leaders.totalGroups > entries.length, (el) => el.child(mutedText(
        `Showing top ${entries.length} of ${leaders.totalGroups} by tokens.`, c)));
  }

  statusCard(c, snapshot, config) {
    const stats = snapshot.stats && typeof snapshot.stats === "object" ? snapshot.stats : null;
    const errors = stats && Number.isFinite(Number(stats.errors)) ? Number(stats.errors) : null;
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.map(warningText).filter(Boolean) : [];
    const sources = config.sources ?? [];
    return card(c).gap(G.md)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
        .child(cardHeader(
          "Scan status",
          `Generated ${formatTimestamp(snapshot.generatedAt) || "unknown"} · last scan ${formatTimestamp(snapshot.lastScanAt) || "unknown"}`,
          c,
        ))
        .child(div().text_size(T.small).text_color(errors > 0 ? c.destructive : errors === 0 ? c.done : c.dim)
          .child(errors === null ? "No scan stats" : errors > 0 ? `${formatInt(errors)} errors` : "No scan errors")))
      // Status rows follow the same top-aligned contract if a note is added.
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.md).items_start()
        .child(statCell("Files", statCount(stats?.files), c, { tooltip: stats?.files === undefined ? "No scan stats" : `${formatInt(stats.files)} files indexed` }))
        .child(statCell("Read", statCount(stats?.filesRead), c, { tooltip: stats?.filesRead === undefined ? "No scan stats" : `${formatInt(stats.filesRead)} files read` }))
        .child(statCell("Unchanged", statCount(stats?.unchangedFiles), c, { tooltip: stats?.unchangedFiles === undefined ? "No scan stats" : `${formatInt(stats.unchangedFiles)} unchanged files` }))
        .child(statCell("Bytes", statBytes(stats?.bytesRead), c, { tooltip: stats?.bytesRead === undefined ? "No scan stats" : `${formatInt(stats.bytesRead)} bytes read` })))
      .child(v_flex().w_full().gap(G.xs)
        .children(sources.map((source, index) => {
          const entry = sourceStatEntry(snapshot, source);
          const status = entry?.status || (source?.enabled === false ? "disabled" : "enabled");
          const statsText = sourceStatsText(entry);
          return h_flex().w_full().gap(G.sm).items_center().py(2)
            .opacity(source?.enabled === false ? 0.55 : 1)
            .child(div().size(6).flex_none().rounded_full().bg(sourceStatusColor(status, c)))
            .child(v_flex().flex_1().min_w(0).gap(1)
              .child(div().text_size(T.body).text_color(c.text).child(source?.label || source?.adapter || `Source ${index + 1}`))
              .child(div().text_size(T.label).text_color(c.dim).truncate()
                .child([(Array.isArray(source?.roots) ? source.roots.join(" · ") : ""), statsText].filter(Boolean).join(" · ") || "No roots configured")))
            .child(v_flex().items_end().gap(1)
              .child(div().text_size(9).text_color(sourceStatusColor(status, c)).child(sourceStatusLabel(status)))
              .child(div().text_size(9).text_color(c.dim).child(source?.adapter || "")));
        })))
      .when(sources.length === 0, (el) => el.child(mutedText("No sources configured.", c)))
      .child(v_flex().w_full().gap(G.xs)
        .child(metaLabel("Warnings", c))
        .when(warnings.length === 0, (el) => el.child(mutedText("No scan warnings.", c)))
        .children(warnings.slice(0, 6).map((warning) => h_flex().w_full().gap(G.sm).items_start()
          .child(div().text_size(10).text_color(c.destructive).child("!"))
          .child(div().flex_1().min_w(0).text_size(T.small).text_color(c.mutedForeground).child(warning))))
        .when(warnings.length > 6, (el) => el.child(mutedText(`+${warnings.length - 6} more warnings`, c))));
  }

  settingsView(c) {
    if (!this.configEditor || !this.refreshInput) {
      return stateCard(c, {
        tone: c.accent,
        title: "Preparing settings",
      });
    }
    const config = normalizeConfig(this.configDraft ?? this.snapshot?.config ?? {});
    const textInput = (state) => controlInput(Input.new(state).w_full(), c);
    const refreshInput = controlInput(Input.new(this.refreshInput).w(110), c);

    const preferences = card(c).gap(G.md)
      .child(cardHeader("Preferences", "", c))
      .child(preferenceRow("Heatmap palette", segmented("ins-palette", [
        { key: "blue", label: "Blue" },
        { key: "green", label: "Green" },
        { key: "purple", label: "Purple" },
      ], config.palette, (key) => this.updateDraft((draft) => { draft.palette = key; }), c), c))
      .child(preferenceRow("Week starts on", segmented("ins-week-start", [
        { key: "0", label: "Sunday" },
        { key: "1", label: "Monday" },
      ], String(config.weekStartsOn), (key) => this.updateDraft((draft) => { draft.weekStartsOn = Number(key); }), c), c))
      .child(preferenceRow(
        "Include cache tokens",
        toggleSwitch("ins-include-cache", config.includeCache, (checked) => this.updateDraft((draft) => { draft.includeCache = checked; }), c, {
          label: "Include cache tokens",
        }),
        c,
      ))
      .child(preferenceRow(
        "Refresh interval",
        h_flex().gap(G.xs).items_center().child(refreshInput).child(mutedText("sec", c)),
        c,
      ));

    const sourceCards = (config.sources ?? []).map((source, index) => {
      const key = sourceKey(source, index);
      const state = this.sourceInputs.get(key);
      return inset(c).gap(G.sm)
        .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center()
          .child(toggleSwitch(`ins-source-${index}`, source?.enabled !== false, (checked) => this.updateDraft((draft) => {
            const target = (draft.sources ?? []).find((item, itemIndex) => sourceKey(item, itemIndex) === key);
            if (target) target.enabled = checked;
          }), c, { label: `${source?.label || source?.adapter || `Source ${index + 1}`} enabled` }))
          .child(fieldLabel(source?.label || source?.adapter || `Source ${index + 1}`, c)))
        .when(state, (el) => el.child(textInput(state)))
        .when(!state, (el) => el.child(mutedText(rootsText(source) || "No roots configured", c)));
    });

    const sources = card(c).gap(G.sm)
      .child(cardHeader("Sources", "", c))
      .when(sourceCards.length === 0, (el) => el.child(mutedText("No sources in this configuration. Add one in the JSON editor.", c)))
      .children(sourceCards);

    const scan = this.statusCard(c, this.snapshot ?? {}, config);

    const json = card(c).gap(G.sm)
      .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
        .child(cardHeader("Configuration JSON", "", c))
        .child(h_flex().flex_wrap().gap(G.xs)
          .child(button("ins-config-format", "Format", (_event, clickCx) => this.formatConfigEditor(clickCx), c, { variant: "outline" }))
          .child(button("ins-config-reset", "Reset", (_event, clickCx) => this.resetConfigDraft(clickCx), c, { variant: "ghost" }))))
      .child(Editor.new(this.configEditor).w_full().h(320).rounded(R.control).border_1().border_color(c.input))
      .child(h_flex().w_full().flex_wrap().gap(G.md).items_center().justify_between()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .when(Boolean(this.saveError), (el) => el.child(div().text_size(T.body).text_color(c.destructive).child(this.saveError)))
          .when(Boolean(this.saveMessage), (el) => el.child(div().text_size(T.body).text_color(c.done).child(this.saveMessage))))
        .child(button("ins-config-save", this.saving ? "Saving…" : "Save configuration", (_event, clickCx) => this.saveConfig(clickCx), c, {
          disabled: this.busy(),
          variant: "primary",
        })));

    return v_flex().w_full().gap(G.lg).children([preferences, sources, scan, json]);
  }
}
