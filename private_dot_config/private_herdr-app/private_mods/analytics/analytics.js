// Pure analytics for Analytics. No host imports: this file runs under Node too.
// Local calendar dates are used everywhere; no UTC day arithmetic.

export const PERIODS = ["today", "week", "month", "year", "all"];
export const HEATMAP_MODES = ["daily", "weekly", "cumulative"];
export const PRESENTATION_VERSION = 1;
export const DEFAULT_SOURCES = [
  {
    id: "pi",
    label: "Pi",
    adapter: "pi",
    enabled: true,
    roots: ["~/.pi/agent/sessions"],
  },
  {
    id: "codex",
    label: "Codex",
    adapter: "codex",
    enabled: true,
    roots: ["~/.codex/sessions", "~/.codex/archived_sessions"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    adapter: "opencode",
    enabled: true,
    roots: ["~/.local/share/opencode"],
  },
  {
    id: "claude",
    label: "Claude Code",
    adapter: "claude",
    enabled: true,
    roots: ["~/.claude/projects"],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    adapter: "antigravity",
    enabled: true,
    roots: ["~/.gemini/antigravity-cli/conversations", "~/.gemini/antigravity-cli/brain"],
  },
];
export const PALETTES = ["blue", "green", "purple"];
export const DEFAULT_REFRESH_SECONDS = 60;
export const MIN_REFRESH_SECONDS = 30;
export const MAX_REFRESH_SECONDS = 3600;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 12).getDate();
}

/** A local calendar day key, `YYYY-MM-DD`. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Parses a day key at local noon, so DST transitions never move the date. */
export function parseDay(value) {
  if (!isDay(value)) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function todayKey(now = new Date()) {
  return dayKey(now);
}

export function addDays(day, count) {
  const date = parseDay(day);
  if (!date) return null;
  date.setDate(date.getDate() + Number(count || 0));
  return dayKey(date);
}

export function addMonthsClamped(day, count) {
  const date = parseDay(day);
  if (!date) return null;
  const wantedDay = date.getDate();
  const moved = new Date(date.getFullYear(), date.getMonth() + Number(count || 0), 1, 12);
  moved.setDate(Math.min(wantedDay, daysInMonth(moved.getFullYear(), moved.getMonth())));
  return dayKey(moved);
}

export function addYearsClamped(day, count) {
  const date = parseDay(day);
  if (!date) return null;
  const wantedMonth = date.getMonth();
  const wantedDay = date.getDate();
  const moved = new Date(date.getFullYear() + Number(count || 0), wantedMonth, 1, 12);
  moved.setDate(Math.min(wantedDay, daysInMonth(moved.getFullYear(), wantedMonth)));
  return dayKey(moved);
}

export function startOfWeek(day, weekStartsOn = 0) {
  const date = parseDay(day);
  if (!date) return null;
  const start = weekStartsOn === 1 ? 1 : 0;
  const offset = (date.getDay() - start + 7) % 7;
  return addDays(day, -offset);
}

export function weekdayLabels(weekStartsOn = 0) {
  const names = weekStartsOn === 1
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names.map((name, index) => (index % 2 === 0 ? name : ""));
}

export function monthLabel(day) {
  const date = parseDay(day);
  return date ? MONTHS[date.getMonth()] : "";
}

export function dayLabel(day, options = {}) {
  const date = parseDay(day);
  if (!date) return String(day ?? "");
  const weekday = options.weekday ? `${options.longWeekday ? WEEKDAYS_LONG[date.getDay()] : WEEKDAYS[date.getDay()]}, ` : "";
  const year = options.year === false ? "" : `, ${date.getFullYear()}`;
  return `${weekday}${MONTHS[date.getMonth()]} ${date.getDate()}${year}`;
}

export function formatTimestamp(iso, options = {}) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = isDay(options.today) ? options.today : todayKey();
  const key = dayKey(date);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (key === today) return `Today ${time}`;
  if (key === addDays(today, -1)) return `Yesterday ${time}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${time}`;
}

export function formatInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const rounded = Math.round(number);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  let output = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) output += ",";
    output += digits[index];
  }
  return sign + output;
}

/** Compact K/M/B formatting for dashboard values; exact values stay in tooltips. */
export function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [divisor, suffix] of units) {
    if (absolute >= divisor * 0.9995) {
      const scaled = absolute / divisor;
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      let text = scaled.toFixed(decimals);
      const dot = text.indexOf(".");
      if (dot >= 0) {
        let end = text.length;
        while (end > dot + 1 && text.charCodeAt(end - 1) === 48) end -= 1;
        if (end === dot + 1) end = dot;
        text = text.slice(0, end);
      }
      return `${sign}${text}${suffix}`;
    }
  }
  return sign + formatInt(absolute);
}

export function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const rounded = round1(number);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

export function formatDuration(ms) {
  const value = finite(ms);
  // A reported 0 means the harness did not expose a task duration.
  if (value <= 0) return "—";
  if (value < 1000) return "<1s";
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}H ${remainder}m` : `${hours}H`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}D ${remainingHours}H` : `${days}D`;
}

export function formatBytes(value) {
  const number = finite(value);
  if (number <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = number;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")} ${units[unit]}`;
}

export function initials(name, maximum = 2) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, maximum).map((word) => word[0]).join("").toUpperCase();
}

export function projectName(path) {
  const text = String(path ?? "").replace(/[\\/]+$/, "");
  if (!text) return "Unknown project";
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || text;
}

export function clampRefreshSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_REFRESH_SECONDS;
  return clamp(Math.round(number), MIN_REFRESH_SECONDS, MAX_REFRESH_SECONDS);
}

export function normalizeConfig(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  return {
    ...source,
    profile: {
      name: typeof profile.name === "string" ? profile.name : "",
      handle: typeof profile.handle === "string" ? profile.handle : "",
      avatar: typeof profile.avatar === "string" ? profile.avatar : "",
    },
    palette: PALETTES.includes(source.palette) ? source.palette : "blue",
    includeCache: source.includeCache !== false,
    weekStartsOn: source.weekStartsOn === 1 ? 1 : 0,
    refreshSeconds: clampRefreshSeconds(source.refreshSeconds),
    sources: Array.isArray(source.sources)
      ? source.sources
      : DEFAULT_SOURCES.map((item) => ({ ...item, roots: [...item.roots] })),
  };
}

export function normalizeTokens(tokens) {
  const value = tokens && typeof tokens === "object" ? tokens : {};
  const hasParts = ["input", "output", "cacheRead", "cacheWrite"].some((key) => Object.prototype.hasOwnProperty.call(value, key));
  const input = finite(value.input);
  const output = finite(value.output);
  const cacheRead = finite(value.cacheRead);
  const cacheWrite = finite(value.cacheWrite);
  const reasoning = finite(value.reasoning);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: hasParts ? input + output + cacheRead + cacheWrite : finite(value.total),
    hasParts,
  };
}

/** input + output (+ cache when included). Reasoning is already inside output. */
export function tokenTotal(tokens, includeCache = true) {
  const value = normalizeTokens(tokens);
  if (!value.hasParts) return value.total;
  return value.input + value.output + (includeCache ? value.cacheRead + value.cacheWrite : 0);
}

export function rowTokenTotal(rowOrTokens, includeCache = true) {
  if (rowOrTokens && typeof rowOrTokens === "object" && rowOrTokens.tokens) return tokenTotal(rowOrTokens.tokens, includeCache);
  return tokenTotal(rowOrTokens, includeCache);
}

export function sumTokens(rows, includeCache = true) {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let reasoning = 0;
  let total = 0;
  let messages = 0;
  let activeMs = 0;
  let longestTaskMs = 0;
  const sessions = new Set();
  const days = new Set();
  for (const row of rows ?? []) {
    const tokens = normalizeTokens(row?.tokens);
    input += tokens.input;
    output += tokens.output;
    cacheRead += tokens.cacheRead;
    cacheWrite += tokens.cacheWrite;
    reasoning += tokens.reasoning;
    total += tokens.hasParts
      ? tokens.input + tokens.output + (includeCache ? tokens.cacheRead + tokens.cacheWrite : 0)
      : tokens.total;
    messages += finite(row?.messages);
    activeMs += finite(row?.activeMs);
    longestTaskMs = Math.max(longestTaskMs, finite(row?.longestTaskMs));
    if (row?.session) sessions.add(row.session);
    if (isDay(row?.day)) days.add(row.day);
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total,
    messages,
    activeMs,
    longestTaskMs,
    sessions: sessions.size,
    days: days.size,
  };
}

function cleanFilter(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "*" || text.toLowerCase() === "all") return null;
  return text;
}

function compileFilters(filters = {}) {
  return {
    source: cleanFilter(filters.source ?? filters.harness),
    provider: cleanFilter(filters.provider),
    model: cleanFilter(filters.model),
    project: cleanFilter(filters.project),
  };
}

function matchesCompiled(row, filters) {
  if (!row) return false;
  if (filters.source && (row.harness || "unknown") !== filters.source) return false;
  if (filters.provider && (row.provider || "unknown") !== filters.provider) return false;
  if (filters.model && (row.model || "unknown") !== filters.model) return false;
  if (filters.project && (row.project || "unknown") !== filters.project) return false;
  return true;
}

export function filterRows(rows, filters = {}) {
  const compiled = compileFilters(filters);
  return (rows ?? []).filter((row) => matchesCompiled(row, compiled));
}

function facetValue(row, field) {
  const raw = field === "source" ? row?.harness : row?.[field];
  return raw === null || raw === undefined || raw === "" ? "unknown" : String(raw);
}

function facetResult(map) {
  return [...map.values()]
    .map((item) => ({
      value: item.value,
      rows: item.rows,
      sessions: item.sessions.size,
      tokens: item.tokens,
      meta: formatCompact(item.tokens),
      tooltip: `${formatInt(item.tokens)} tokens · ${formatInt(item.sessions.size)} sessions`,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.value.localeCompare(b.value));
}

/** Distinct values with token and session counts, ready for filter menus. */
export function facetStats(rows, field, includeCache = true) {
  const map = new Map();
  for (const row of rows ?? []) {
    const value = facetValue(row, field);
    let item = map.get(value);
    if (!item) {
      item = { value, rows: 0, sessions: new Set(), tokens: 0 };
      map.set(value, item);
    }
    item.rows += 1;
    if (row?.session) item.sessions.add(row.session);
    item.tokens += rowTokenTotal(row, includeCache);
  }
  return facetResult(map);
}

/**
 * All four filter facets in one pass over the snapshot. Each facet ignores its
 * own active filter so a selected value can always be changed or cleared.
 */
export function facetStatsAll(rows, filters = {}, includeCache = true) {
  const base = compileFilters(filters);
  const fields = ["source", "provider", "model", "project"];
  const compiled = {};
  const maps = {};
  for (const field of fields) {
    compiled[field] = { ...base, [field]: null };
    maps[field] = new Map();
  }
  for (const row of rows ?? []) {
    const tokens = rowTokenTotal(row, includeCache);
    for (const field of fields) {
      if (!matchesCompiled(row, compiled[field])) continue;
      const value = facetValue(row, field);
      let item = maps[field].get(value);
      if (!item) {
        item = { value, rows: 0, sessions: new Set(), tokens: 0 };
        maps[field].set(value, item);
      }
      item.rows += 1;
      if (row?.session) item.sessions.add(row.session);
      item.tokens += tokens;
    }
  }
  const result = {};
  for (const field of fields) result[field] = facetResult(maps[field]);
  return result;
}

export function availableYears(rows, today = todayKey()) {
  const years = new Set([Number(today.slice(0, 4))]);
  for (const row of rows ?? []) {
    if (isDay(row?.day)) years.add(Number(row.day.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

export function periodRange(period = "all", options = {}) {
  const today = isDay(options.today) ? options.today : todayKey();
  const weekStartsOn = options.weekStartsOn === 1 ? 1 : 0;
  const currentYear = Number(today.slice(0, 4));
  const selectedYear = Number.isInteger(options.year) ? options.year : currentYear;

  if (period === "today") {
    const yesterday = addDays(today, -1);
    return { period, start: today, end: today, previous: { start: yesterday, end: yesterday }, label: "Today so far" };
  }

  if (period === "week") {
    const start = startOfWeek(today, weekStartsOn);
    return {
      period: "week",
      start,
      end: today,
      previous: { start: addDays(start, -7), end: addDays(today, -7) },
      label: `Week of ${dayLabel(start, { year: false })}`,
    };
  }

  if (period === "month") {
    const start = `${today.slice(0, 7)}-01`;
    const date = parseDay(today);
    return {
      period: "month",
      start,
      end: today,
      previous: { start: addMonthsClamped(start, -1), end: addMonthsClamped(today, -1) },
      label: `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`,
    };
  }

  if (period === "year") {
    const start = `${selectedYear}-01-01`;
    const end = selectedYear >= currentYear ? today : `${selectedYear}-12-31`;
    return {
      period: "year",
      start,
      end,
      previous: { start: `${selectedYear - 1}-01-01`, end: addYearsClamped(end, -1) },
      label: String(selectedYear),
    };
  }

  return { period: "all", start: null, end: today, previous: null, label: "All time" };
}

export function rangeContains(day, range) {
  if (!isDay(day) || !range) return false;
  if (range.start && day < range.start) return false;
  if (range.end && day > range.end) return false;
  return true;
}

export function filterRowsByRange(rows, range) {
  if (!range) return [...(rows ?? [])];
  return (rows ?? []).filter((row) => rangeContains(row?.day, range));
}

export function activityDays(rows, includeCache = true) {
  const days = new Set();
  for (const row of rows ?? []) {
    if (!isDay(row?.day)) continue;
    const tokens = rowTokenTotal(row, includeCache);
    if (tokens > 0 || finite(row?.messages) > 0 || finite(row?.longestTaskMs) > 0) days.add(row.day);
  }
  return [...days].sort();
}

export function streakStats(rows, options = {}) {
  const today = isDay(options.today) ? options.today : todayKey();
  const includeCache = options.includeCache !== false;
  const days = activityDays(rows, includeCache).filter((day) => day <= today);
  let longest = 0;
  let run = 0;
  let lastRun = 0;
  let previous = null;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    lastRun = run;
    previous = day;
  }
  let current = 0;
  if (days.length) {
    const last = days[days.length - 1];
    // Grace: a streak that ended yesterday is still the current streak today.
    if (last === today || last === addDays(today, -1)) current = lastRun;
  }
  return { current, longest, activeDays: days.length, lastActive: previous };
}

export function peakDay(rows, includeCache = true) {
  const totals = new Map();
  const sessions = new Map();
  for (const row of rows ?? []) {
    if (!isDay(row?.day)) continue;
    totals.set(row.day, (totals.get(row.day) ?? 0) + rowTokenTotal(row, includeCache));
    if (!row?.session) continue;
    let set = sessions.get(row.day);
    if (!set) {
      set = new Set();
      sessions.set(row.day, set);
    }
    set.add(row.session);
  }
  let best = { day: null, tokens: 0, sessions: 0 };
  for (const day of [...totals.keys()].sort()) {
    const tokens = totals.get(day) ?? 0;
    if (tokens > best.tokens) best = { day, tokens, sessions: sessions.get(day)?.size ?? 0 };
  }
  return best.tokens > 0 ? best : { day: null, tokens: 0, sessions: 0 };
}

/** Cache reads as a share of all input-side tokens, as a short percent. */
export function formatHitRate(input, cacheRead) {
  const total = finite(input) + finite(cacheRead);
  if (total <= 0) return "—";
  return `${round1((finite(cacheRead) / total) * 100)}%`;
}

/** Percent change with explicit New / zero-safe / no-previous states. */
export function compareChange(current, previous, hasPrevious = true) {
  const now = finite(current);
  const before = finite(previous);
  if (!hasPrevious) return { kind: "none", direction: "none", pct: null, label: "—" };
  if (before === 0) {
    if (now === 0) return { kind: "flat", direction: "flat", pct: 0, label: "0%" };
    return { kind: "new", direction: "up", pct: null, label: "New" };
  }
  const pct = round1(((now - before) / before) * 100);
  if (pct === 0) return { kind: "flat", direction: "flat", pct: 0, label: "0%" };
  return {
    kind: pct > 0 ? "up" : "down",
    direction: pct > 0 ? "up" : "down",
    pct,
    label: formatPercent(pct),
  };
}

function displayName(value, kind) {
  const text = value === null || value === undefined || value === "" ? "unknown" : String(value);
  if (text.toLowerCase() === "unknown") return kind === "provider" ? "Unknown provider" : "Unknown model";
  return text;
}

function topKey(map) {
  let best = null;
  for (const [key, value] of map.entries()) {
    if (!best || value > best[1] || (value === best[1] && key.localeCompare(best[0]) < 0)) best = [key, value];
  }
  return best ? best[0] : "Unknown";
}

export function leaderboard(rows, previousRows, options = {}) {
  const groupBy = options.groupBy === "provider" ? "provider" : "model";
  const includeCache = options.includeCache !== false;
  const hasPrevious = Array.isArray(previousRows);
  const groups = new Map();
  const allSessions = new Set();

  for (const row of rows ?? []) {
    const name = displayName(row?.[groupBy], groupBy);
    let group = groups.get(name);
    if (!group) {
      group = { name, tokens: 0, rows: 0, messages: 0, longestTaskMs: 0, sessions: new Set(), providers: new Map(), models: new Map() };
      groups.set(name, group);
    }
    const tokens = rowTokenTotal(row, includeCache);
    group.tokens += tokens;
    group.rows += 1;
    group.messages += finite(row?.messages);
    group.longestTaskMs = Math.max(group.longestTaskMs, finite(row?.longestTaskMs));
    if (row?.session) {
      group.sessions.add(row.session);
      allSessions.add(row.session);
    }
    if (groupBy === "model") {
      const provider = displayName(row?.provider, "provider");
      group.providers.set(provider, (group.providers.get(provider) ?? 0) + tokens);
    } else {
      const model = displayName(row?.model, "model");
      group.models.set(model, (group.models.get(model) ?? 0) + tokens);
    }
  }

  const previousTotals = new Map();
  if (hasPrevious) {
    for (const row of previousRows) {
      const name = displayName(row?.[groupBy], groupBy);
      previousTotals.set(name, (previousTotals.get(name) ?? 0) + rowTokenTotal(row, includeCache));
    }
  }

  let totalTokens = 0;
  for (const group of groups.values()) totalTokens += group.tokens;

  const entries = [...groups.values()].map((group) => {
    const previous = hasPrevious ? (previousTotals.get(group.name) ?? 0) : null;
    const sublabel = groupBy === "model"
      ? (group.providers.size > 1 ? `${topKey(group.providers)} +${group.providers.size - 1}` : topKey(group.providers))
      : `${group.models.size} model${group.models.size === 1 ? "" : "s"}`;
    return {
      name: group.name,
      sublabel,
      provider: groupBy === "model" ? topKey(group.providers) : group.name,
      tokens: group.tokens,
      rows: group.rows,
      messages: group.messages,
      longestTaskMs: group.longestTaskMs,
      sessions: group.sessions.size,
      share: totalTokens > 0 ? group.tokens / totalTokens : 0,
      sharePct: totalTokens > 0 ? (group.tokens / totalTokens) * 100 : 0,
      previous,
      change: compareChange(group.tokens, previous ?? 0, hasPrevious),
    };
  });

  entries.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  entries.forEach((entry, index) => { entry.rank = index + 1; });

  const limit = options.limit === undefined ? 10 : Math.max(0, Math.floor(Number(options.limit) || 0));
  return {
    groupBy,
    entries: limit > 0 ? entries.slice(0, limit) : entries,
    allEntries: entries,
    totalGroups: entries.length,
    totalTokens,
    totalSessions: allSessions.size,
    hasPrevious,
    limit,
  };
}

/**
 * Weekly stacked model usage over a trailing window. Buckets each week's
 * tokens per model, keeps the top models, and folds the rest into "Other".
 * Pure presentation data: no row identity, only names and token totals.
 */
export function buildModelSeries(rows, options = {}) {
  const weekStartsOn = options.weekStartsOn === 1 ? 1 : 0;
  const includeCache = options.includeCache !== false;
  const weekCount = Math.max(1, Math.floor(Number(options.weeks) || 26));
  const limit = Math.max(1, Math.floor(Number(options.limit) || 7));
  const endDay = isDay(options.endDay)
    ? options.endDay
    : isDay(options.today)
      ? options.today
      : todayKey();
  const endWeekStart = startOfWeek(endDay, weekStartsOn);
  const startDay = addDays(endWeekStart, -(weekCount - 1) * 7);

  const modelTotals = new Map();
  const weekly = new Map();
  for (const row of rows ?? []) {
    if (!isDay(row?.day) || row.day < startDay || row.day > endDay) continue;
    const name = displayName(row?.model, "model");
    const tokens = rowTokenTotal(row, includeCache);
    modelTotals.set(name, (modelTotals.get(name) ?? 0) + tokens);
    const weekStart = startOfWeek(row.day, weekStartsOn);
    let bucket = weekly.get(weekStart);
    if (!bucket) {
      bucket = new Map();
      weekly.set(weekStart, bucket);
    }
    bucket.set(name, (bucket.get(name) ?? 0) + tokens);
  }

  const top = [...modelTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
  const keep = new Set(top);

  const weeks = [];
  let maxTotal = 0;
  let windowTotal = 0;
  let hasOther = false;
  for (let index = 0; index < weekCount; index += 1) {
    const weekStart = addDays(startDay, index * 7);
    const bucket = weekly.get(weekStart);
    const segments = [];
    let total = 0;
    for (const name of top) {
      const tokens = bucket?.get(name) ?? 0;
      if (tokens > 0) segments.push({ name, tokens });
      total += tokens;
    }
    let other = 0;
    if (bucket) {
      for (const [name, tokens] of bucket) {
        if (!keep.has(name)) other += tokens;
      }
    }
    if (other > 0) {
      hasOther = true;
      segments.push({ name: "Other", tokens: other });
      total += other;
    }
    if (total > maxTotal) maxTotal = total;
    windowTotal += total;
    weeks.push({ start: weekStart, total, segments });
  }

  return {
    weeks,
    models: hasOther ? [...top, "Other"] : top,
    maxTotal,
    windowTotal,
    includeCache,
    range: { start: startDay, end: endDay },
  };
}

export function intensityLevel(value, maximum) {
  const amount = finite(value);
  const max = finite(maximum);
  if (amount <= 0 || max <= 0) return 0;
  const ratio = amount / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * A 53-week by 7-day calendar. Weekly mode repeats that week's total on each
 * day; cumulative mode is the all-time running total through each day.
 */
export function buildHeatmap(rows, options = {}) {
  const weekStartsOn = options.weekStartsOn === 1 ? 1 : 0;
  const mode = HEATMAP_MODES.includes(options.mode) ? options.mode : "daily";
  const includeCache = options.includeCache !== false;
  const weekCount = Math.max(1, Math.floor(Number(options.weeks) || 53));
  const endDay = isDay(options.endDay)
    ? options.endDay
    : isDay(options.today)
      ? options.today
      : todayKey();
  const endWeekStart = startOfWeek(endDay, weekStartsOn);
  const startDay = addDays(endWeekStart, -(weekCount - 1) * 7);
  const lastDay = addDays(endWeekStart, 6);

  const daily = new Map();
  const daySessions = new Map();
  for (const row of rows ?? []) {
    if (!isDay(row?.day) || row.day > endDay) continue;
    daily.set(row.day, (daily.get(row.day) ?? 0) + rowTokenTotal(row, includeCache));
    if (row.session) {
      let sessions = daySessions.get(row.day);
      if (!sessions) {
        sessions = new Set();
        daySessions.set(row.day, sessions);
      }
      sessions.add(row.session);
    }
  }

  const activity = [...daily.keys()].sort().map((day) => ({
    day,
    tokens: daily.get(day) ?? 0,
    sessions: daySessions.get(day) ?? new Set(),
  }));

  let activityIndex = 0;
  let cumulativeTokens = 0;
  const cumulativeSessions = new Set();
  const cells = [];
  const weeks = [];

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekStart = addDays(startDay, weekIndex * 7);
    let weekTotal = 0;
    const weekSessions = new Set();
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(weekStart, offset);
      if (day <= endDay) {
        weekTotal += daily.get(day) ?? 0;
        for (const session of daySessions.get(day) ?? []) weekSessions.add(session);
      }
    }
    const weekDays = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(weekStart, offset);
      while (activityIndex < activity.length && activity[activityIndex].day <= day) {
        const item = activity[activityIndex];
        activityIndex += 1;
        cumulativeTokens += item.tokens;
        for (const session of item.sessions) cumulativeSessions.add(session);
      }
      const dailyTokens = daily.get(day) ?? 0;
      const daySessionCount = daySessions.get(day)?.size ?? 0;
      const value = mode === "weekly" ? weekTotal : mode === "cumulative" ? cumulativeTokens : dailyTokens;
      const future = day > endDay;
      const cell = {
        date: day,
        weekStart,
        value,
        daily: dailyTokens,
        weekTotal,
        cumulative: cumulativeTokens,
        sessions: mode === "weekly" ? weekSessions.size : mode === "cumulative" ? cumulativeSessions.size : daySessionCount,
        dailySessions: daySessionCount,
        weekSessions: weekSessions.size,
        cumulativeSessions: cumulativeSessions.size,
        future,
        level: 0,
      };
      weekDays.push(cell);
      cells.push(cell);
    }
    weeks.push({ start: weekStart, days: weekDays });
  }

  let maxValue = 0;
  for (const cell of cells) {
    if (!cell.future && cell.value > maxValue) maxValue = cell.value;
  }
  for (const cell of cells) {
    cell.level = cell.future ? 0 : intensityLevel(cell.value, maxValue);
    cell.tooltip = cell.future ? "" : heatmapTooltip(cell, mode);
  }

  const months = [];
  let lastMonth = null;
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const month = weeks[weekIndex].start.slice(0, 7);
    if (month !== lastMonth) {
      months.push({ week: weekIndex, span: 1, label: monthLabel(weeks[weekIndex].start), month });
      lastMonth = month;
    } else {
      months[months.length - 1].span += 1;
    }
  }

  let windowTotal = 0;
  for (const day of daily.keys()) {
    if (day >= startDay && day <= lastDay) windowTotal += daily.get(day) ?? 0;
  }

  return {
    mode,
    weekStartsOn,
    includeCache,
    weeks,
    cells,
    maxValue,
    windowTotal,
    months,
    range: { start: startDay, end: lastDay, dataEnd: endDay },
  };
}

function resolvedDashboardOptions(options = {}, fallbackToday = todayKey()) {
  const today = isDay(options.today) ? options.today : fallbackToday;
  return {
    filters: options.filters && typeof options.filters === "object" ? options.filters : {},
    period: PERIODS.includes(options.period) ? options.period : "all",
    year: Number.isInteger(options.year) ? options.year : Number(today.slice(0, 4)),
    heatmapMode: HEATMAP_MODES.includes(options.heatmapMode) ? options.heatmapMode : "daily",
    leaderboardGroup: options.leaderboardGroup === "provider" ? "provider" : "model",
    selectedDay: isDay(options.selectedDay) ? options.selectedDay : today,
    today,
  };
}

/**
 * One complete dashboard derivation. Keep this pure so the native view can
 * memoize it without serializing a snapshot for a cache key.
 */
export function deriveDashboard(snapshot, options = {}) {
  const config = normalizeConfig(snapshot?.config ?? {});
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const settings = resolvedDashboardOptions(options);
  const { filters, period, year, heatmapMode, leaderboardGroup, today } = settings;
  const years = availableYears(rows, today);
  const includeCache = config.includeCache;
  // Token usage (metrics, heatmap, day detail) always covers everything;
  // period and facet filters scope only the model usage sections.
  const dimensionRows = filterRows(rows, filters);
  const range = periodRange(period, { today, weekStartsOn: config.weekStartsOn, year });
  const periodRows = filterRowsByRange(dimensionRows, range);
  const previousRows = range.previous ? filterRowsByRange(dimensionRows, range.previous) : null;

  const lifetime = sumTokens(rows, includeCache);
  const peak = peakDay(rows, includeCache);
  const streaks = streakStats(rows, { today, includeCache });
  const heatmap = buildHeatmap(rows, {
    endDay: today,
    weekStartsOn: config.weekStartsOn,
    mode: heatmapMode,
    includeCache,
  });
  const totals = sumTokens(periodRows, includeCache);
  const leaders = leaderboard(periodRows, previousRows, {
    groupBy: leaderboardGroup,
    includeCache,
    limit: 10,
  });
  const modelSeries = buildModelSeries(dimensionRows, {
    endDay: range.end,
    weekStartsOn: config.weekStartsOn,
    includeCache,
  });

  const selectedInRange = heatmap.cells.find((cell) => cell.date === settings.selectedDay && !cell.future);
  const selectedDay = selectedInRange ? settings.selectedDay : heatmap.range.dataEnd;
  const selectedRows = rows.filter((row) => row.day === selectedDay);
  const selectedTotals = sumTokens(selectedRows, includeCache);
  const selectedTop = selectedRows.length
    ? leaderboard(selectedRows, null, { groupBy: "model", includeCache, limit: 1 }).entries[0]
    : null;
  const lifetimeTop = rows.length
    ? leaderboard(rows, null, { groupBy: "model", includeCache, limit: 1 }).entries[0] ?? null
    : null;

  const facetStatsByField = facetStatsAll(rows, filters, includeCache);
  const facets = {};
  for (const field of ["source", "provider", "model", "project"]) {
    const stats = facetStatsByField[field];
    const total = stats.reduce((sum, stat) => sum + stat.tokens, 0);
    facets[field] = {
      stats,
      total,
      totalMeta: formatCompact(total),
      totalTooltip: `${formatInt(total)} tokens`,
    };
  }

  return {
    snapshot,
    config,
    rows,
    years,
    filters,
    period,
    year,
    heatmapMode,
    leaderboardGroup,
    includeCache,
    today,
    dimensionRows,
    periodRows,
    previousRows,
    range,
    lifetime,
    peak,
    streaks,
    heatmap,
    totals,
    leaders,
    selectedDay,
    selectedRows,
    selectedTotals,
    selectedTop,
    lifetimeTop,
    facets,
    modelSeries,
    operations: deriveOperations(snapshot, periodRows, previousRows, range, includeCache),
  };
}

/** Input reuse includes cache creation in the input-side denominator. */
export function inputReuse(totals) {
  const inputSide = totals.input + totals.cacheRead + totals.cacheWrite;
  return inputSide > 0 ? round1(totals.cacheRead / inputSide * 100) : null;
}

function sessionKey(row) {
  return JSON.stringify([row.harness ?? "unknown", row.session]);
}

function operationalTotals(rows, includeCache) {
  const totals = sumTokens(rows, includeCache);
  totals.sessions = new Set(rows.filter((row) => row.session).map(sessionKey)).size;
  return { ...totals, reusePct: inputReuse(totals) };
}

function groupedUsage(rows, field, includeCache) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[field] || "unknown");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([name, group]) => ({ name, ...operationalTotals(group, includeCache) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Bounded, metadata-only drilldowns. No prompt text or inferred task outcomes. */
export function deriveOperations(snapshot, rows, previousRows, range, includeCache = true) {
  const allRows = snapshot?.rows ?? [];
  const observedDays = allRows.map((row) => row.day).filter(isDay).sort();
  const firstDay = observedDays[0] ?? null;
  const totals = operationalTotals(rows, includeCache);
  const previous = operationalTotals(previousRows ?? [], includeCache);
  const baselineCovered = Boolean(range.previous && firstDay && firstDay <= range.previous.start);
  const projects = groupedUsage(rows, "project", includeCache);
  const previousProjects = groupedUsage(previousRows ?? [], "project", includeCache);
  const nowByProject = new Map(projects.map((entry) => [entry.name, entry.total]));
  const beforeByProject = new Map(previousProjects.map((entry) => [entry.name, entry.total]));
  const drivers = range.previous ? [...new Set([...nowByProject.keys(), ...beforeByProject.keys()])]
    .map((name) => ({ name, current: nowByProject.get(name) ?? 0, previous: beforeByProject.get(name) ?? 0 }))
    .map((entry) => ({ ...entry, delta: entry.current - entry.previous }))
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name)) : [];

  const sessionRows = new Map();
  for (const row of rows) {
    if (!row.session) continue;
    const key = sessionKey(row);
    if (!sessionRows.has(key)) sessionRows.set(key, []);
    sessionRows.get(key).push(row);
  }
  const sessions = [...sessionRows].map(([key, group]) => {
    const dates = group.map((row) => row.day).filter(isDay).sort();
    return {
      key, id: String(group[0].session), harness: String(group[0].harness || "unknown"),
      projects: [...new Set(group.map((row) => String(row.project || "unknown")))],
      firstDay: dates[0] ?? null, lastDay: dates.at(-1) ?? null,
      ...operationalTotals(group, includeCache),
      models: groupedUsage(group, "model", includeCache).slice(0, 8),
    };
  }).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const sources = (snapshot?.config?.sources ?? []).map((source) => ({
    name: source.label || source.id,
    status: source.enabled === false ? "disabled" : snapshot.sourceStats?.[source.id]?.status ?? "unknown",
    files: snapshot.sourceStats?.[source.id]?.files ?? null,
    errors: snapshot.sourceStats?.[source.id]?.errors ?? null,
  }));
  return {
    totals, previous, baselineCovered,
    change: compareChange(totals.total, previous.total, baselineCovered),
    firstDay, lastDay: observedDays.at(-1) ?? null,
    projects: projects.slice(0, 10), projectCount: projects.length,
    harnesses: groupedUsage(rows, "harness", includeCache).slice(0, 20),
    drivers: drivers.slice(0, 5), sessions: sessions.slice(0, 50), sessionCount: sessions.length,
    coverage: {
      sources,
      partial: ["starting", "running", "partial"].includes(snapshot?.scan?.status),
      scanStatus: snapshot?.scan?.status ?? "unknown",
      errors: snapshot?.stats?.errors ?? null,
      warnings: snapshot?.warnings?.length ?? 0,
      unknownProjects: rows.filter((row) => !row.project || row.project === "unknown").length,
      unknownModels: rows.filter((row) => !row.model || row.model === "unknown").length,
      lastScanAt: snapshot?.lastCompletedScanAt ?? snapshot?.lastScanAt ?? null,
    },
  };
}

const DASHBOARD_KEY_FIELDS = [
  "snapshot",
  "configSource",
  "includeCache",
  "weekStartsOn",
  "source",
  "provider",
  "model",
  "project",
  "period",
  "year",
  "heatmapMode",
  "leaderboardGroup",
  "selectedDay",
  "today",
];

function sameDashboardKey(left, right) {
  return DASHBOARD_KEY_FIELDS.every((field) => left[field] === right[field]);
}

function dashboardKey(snapshot, options = {}) {
  const resolved = resolvedDashboardOptions(options);
  const config = normalizeConfig(snapshot?.config ?? {});
  const filters = resolved.filters;
  return {
    snapshot,
    configSource: snapshot?.config ?? null,
    includeCache: config.includeCache,
    weekStartsOn: config.weekStartsOn,
    source: cleanFilter(filters.source ?? filters.harness) ?? "all",
    provider: cleanFilter(filters.provider) ?? "all",
    model: cleanFilter(filters.model) ?? "all",
    project: cleanFilter(filters.project) ?? "all",
    period: resolved.period,
    year: resolved.year,
    heatmapMode: resolved.heatmapMode,
    leaderboardGroup: resolved.leaderboardGroup,
    selectedDay: resolved.selectedDay,
    today: resolved.today,
  };
}

/**
 * The small dashboard payload the native view may hold. Raw snapshot rows are
 * intentionally omitted so QuickJS parses bounded presentation data, never the
 * full analytics input on every refresh or filter change.
 */
export function compactDashboard(derived) {
  // The native menus display only 250 values. Do not ship thousands of hidden
  // facet records into QuickJS; retain the selected value and full totals.
  const facets = Object.fromEntries(Object.entries(derived?.facets ?? {}).map(([field, facet]) => {
    const all = facet.stats ?? [];
    const stats = all.slice(0, 250);
    const selected = derived?.filters?.[field];
    if (selected && selected !== "all" && !stats.some((stat) => stat.value === selected)) {
      const retained = all.find((stat) => stat.value === selected);
      if (retained) {
        if (stats.length === 250) stats.pop();
        stats.push(retained);
      }
    }
    return [field, { ...facet, stats, truncated: all.length > stats.length, totalCount: all.length }];
  }));
  const heatmap = derived?.heatmap ?? {};
  const leaders = derived?.leaders ?? {};
  return {
    config: derived?.config ?? {},
    years: derived?.years ?? [],
    filters: derived?.filters ?? {},
    period: derived?.period,
    year: derived?.year,
    heatmapMode: derived?.heatmapMode,
    leaderboardGroup: derived?.leaderboardGroup,
    includeCache: derived?.includeCache,
    today: derived?.today,
    range: derived?.range,
    lifetime: derived?.lifetime,
    peak: derived?.peak,
    streaks: derived?.streaks,
    totals: derived?.totals,
    operations: derived?.operations ?? null,
    selectedDay: derived?.selectedDay,
    selectedTotals: derived?.selectedTotals,
    selectedTop: derived?.selectedTop ?? null,
    lifetimeTop: derived?.lifetimeTop ?? null,
    selectedRowCount: Array.isArray(derived?.selectedRows) ? derived.selectedRows.length : 0,
    rowCount: Array.isArray(derived?.rows) ? derived.rows.length : 0,
    facets,
    modelSeries: derived?.modelSeries ?? null,
    heatmap: {
      mode: heatmap.mode,
      weekStartsOn: heatmap.weekStartsOn,
      includeCache: heatmap.includeCache,
      weeks: heatmap.weeks ?? [],
      maxValue: heatmap.maxValue ?? 0,
      windowTotal: heatmap.windowTotal ?? 0,
      months: heatmap.months ?? [],
      range: heatmap.range,
    },
    leaders: {
      groupBy: leaders.groupBy,
      entries: leaders.entries ?? [],
      totalGroups: leaders.totalGroups ?? 0,
      totalTokens: leaders.totalTokens ?? 0,
      totalSessions: leaders.totalSessions ?? 0,
      hasPrevious: Boolean(leaders.hasPrevious),
      limit: leaders.limit ?? 0,
    },
  };
}

/** Escapes one value for a Markdown table cell. */
function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function markdownChange(entry) {
  const change = entry?.change;
  if (!change || change.kind === "none") return "—";
  if (change.kind === "new") return "New";
  const previous = Number(entry?.previous);
  return Number.isFinite(previous)
    ? `${change.label} (${formatInt(previous)} before)`
    : String(change.label ?? "—");
}

/**
 * A portable Markdown report of one prepared dashboard. Pure: it reads only the
 * compact presentation already held by the view, so exporting never rescans,
 * re-derives analytics, or runs the collector. Token counts stay exact; the
 * dashboard's compact K/M/B labels are intentionally not reused.
 */
export function dashboardMarkdown(dashboard, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const generated = Number.isNaN(now.getTime()) ? "" : `${dayKey(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const includeCache = dashboard.includeCache !== false;
  const range = dashboard.range ?? {};
  const lifetime = dashboard.lifetime ?? {};
  const selectedTotals = dashboard.selectedTotals ?? {};
  const selectedTop = dashboard.selectedTop ?? null;
  const leaders = dashboard.leaders ?? {};
  const heatmap = dashboard.heatmap ?? {};
  const filters = dashboard.filters ?? {};
  const rangeLabel = range.label ?? (dashboard.period === "all" ? "All time" : "Selected period");
  const filterLabel = (value) => (!value || value === "all" ? "All" : markdownCell(value));
  const dataThrough = dashboard.today ?? range.end ?? "";
  const selectedDay = isDay(dashboard.selectedDay) ? dashboard.selectedDay : dataThrough;
  const lines = [];

  lines.push(`# Analytics — ${rangeLabel}`, "");
  if (options.machine != null) lines.push(`- Machine: ${markdownCell(options.machine)}`);
  lines.push(`- Generated: ${generated || "unknown"} (local)`);
  lines.push(`- Data through: ${dayLabel(dataThrough) || "unknown"}`);
  lines.push(`- Period: ${rangeLabel}${range.start && range.end ? ` (${range.start} to ${range.end})` : ""}`);
  lines.push(`- Filters: Agent tool: ${filterLabel(filters.source)} · Project: ${filterLabel(filters.project)} · Provider: ${filterLabel(filters.provider)} · Model: ${filterLabel(filters.model)}`);
  lines.push(`- Tokens: input + output${includeCache ? " + cache reads + cache writes" : " (cache excluded)"}`);
  lines.push("", "Lifetime and token history cover every session. Model usage follows the selected period and filters.", "");

  const operations = dashboard.operations;
  if (operations) {
    lines.push("## Selected-period usage", "");
    lines.push(`Local records only. ${operations.baselineCovered ? "Earlier baseline records exist; this is not a completeness guarantee." : "No complete earlier baseline is established."} Calendar-day totals; today is incomplete.`, "");
    lines.push("| Metric | Value |", "| --- | ---: |");
    lines.push(`| Tokens | ${formatInt(operations.totals.total)} |`);
    lines.push(`| Sessions | ${formatInt(operations.totals.sessions)} |`);
    lines.push(`| New input (uncached + cache writes) | ${formatInt(operations.totals.input + operations.totals.cacheWrite)} |`);
    lines.push(`| Output (includes reasoning) | ${formatInt(operations.totals.output)} |`);
    lines.push(`| Input reuse | ${operations.totals.reusePct === null ? "—" : `${operations.totals.reusePct}%`} |`, "");
    for (const [title, entries] of [["Agent tools", operations.harnesses], ["Projects", operations.projects]]) {
      lines.push(`### ${title}`, "", "| Name | Tokens | Sessions |", "| --- | ---: | ---: |");
      for (const entry of entries) lines.push(`| ${markdownCell(entry.name)} | ${formatInt(entry.total)} | ${entry.sessions} |`);
      lines.push("");
    }
    lines.push("### Sessions to inspect", "", `Top ${operations.sessions.length} of ${operations.sessionCount} in the selected period.`, "");
    lines.push("| Session | Agent tool | Project | Tokens |", "| --- | --- | --- | ---: |");
    for (const session of operations.sessions) lines.push(`| ${markdownCell(session.id)} | ${markdownCell(session.harness)} | ${markdownCell(session.projects.join(", "))} | ${formatInt(session.total)} |`);
    lines.push("", "### Data coverage", "");
    for (const source of operations.coverage.sources) lines.push(`- ${markdownCell(source.name)}: ${source.status}`);
    lines.push(`- Scan in progress: ${operations.coverage.partial ? "yes" : "no"}; errors: ${operations.coverage.errors ?? "unknown"}; warnings: ${operations.coverage.warnings}`, "");
    lines.push("Live agent status and account quotas are separate scopes and are not included in this local-history export.", "");
  }

  lines.push("## Lifetime", "");
  lines.push("| Metric | Value |", "| --- | ---: |");
  lines.push(`| Tokens | ${formatInt(lifetime.total)} |`);
  lines.push(`| Sessions | ${formatInt(lifetime.sessions)} |`);
  lines.push(`| Active days | ${formatInt(lifetime.days)} |`);
  lines.push(`| Messages | ${formatInt(lifetime.messages)} |`);
  lines.push(`| Peak day | ${dashboard.peak?.day ? `${formatInt(dashboard.peak.tokens)} tokens on ${dayLabel(dashboard.peak.day)}` : "—"} |`);
  lines.push(`| Longest task (observed) | ${formatDuration(lifetime.longestTaskMs)} |`);
  lines.push(`| Longest streak | ${formatInt(dashboard.streaks?.longest)} days |`);
  lines.push(`| Current streak | ${formatInt(dashboard.streaks?.current)} days |`, "");

  lines.push(`## ${selectedDay === dashboard.today ? "Today" : "Selected day"} — ${dayLabel(selectedDay, { weekday: true })}`, "");
  lines.push("| Metric | Value |", "| --- | ---: |");
  lines.push(`| Tokens | ${formatInt(selectedTotals.total)} |`);
  lines.push(`| Input | ${formatInt(selectedTotals.input)} |`);
  lines.push(`| Output | ${formatInt(selectedTotals.output)} |`);
  lines.push(`| Reasoning (inside output) | ${formatInt(selectedTotals.reasoning)} |`);
  lines.push(`| Cache reads | ${formatInt(selectedTotals.cacheRead)} |`);
  lines.push(`| Cache writes | ${formatInt(selectedTotals.cacheWrite)} |`);
  lines.push(`| Cache hit rate | ${formatHitRate(selectedTotals.input, selectedTotals.cacheRead)} |`);
  lines.push(`| Sessions | ${formatInt(selectedTotals.sessions)} |`);
  lines.push(`| Messages | ${formatInt(selectedTotals.messages)} |`);
  lines.push(`| Top model | ${selectedTop ? `${markdownCell(selectedTop.name)} (${formatInt(selectedTop.tokens)} tokens)` : "—"} |`, "");

  lines.push(`## ${rangeLabel} model usage`, "");
  if (!Array.isArray(leaders.entries) || leaders.entries.length === 0) {
    lines.push("_No usage in this period._", "");
  } else {
    lines.push(`${formatInt(leaders.totalTokens)} tokens · ${formatInt(leaders.totalSessions)} sessions · ${formatInt(leaders.totalGroups)} models`, "");
    lines.push(leaders.groupBy === "provider"
      ? "| # | Provider | Models | Tokens | Share | Sessions | vs previous |"
      : "| # | Model | Provider(s) | Tokens | Share | Sessions | vs previous |");
    lines.push("| ---: | --- | --- | ---: | ---: | ---: | --- |");
    for (const entry of leaders.entries) {
      lines.push(`| ${formatInt(entry.rank)} | ${markdownCell(entry.name)} | ${markdownCell(entry.sublabel)} | ${formatInt(entry.tokens)} | ${round1(Number(entry.sharePct) || 0)}% | ${formatInt(entry.sessions)} | ${markdownChange(entry)} |`);
    }
    if (leaders.totalGroups > leaders.entries.length) {
      lines.push("", `Showing top ${leaders.entries.length} of ${leaders.totalGroups} by tokens.`);
    }
    lines.push("");
  }

  const weeks = Array.isArray(heatmap.weeks) ? heatmap.weeks : [];
  const activeWeeks = weeks.filter((week) => {
    const first = week?.days?.[0];
    return Number(first?.weekTotal) > 0 || Number(first?.weekSessions) > 0;
  });
  if (activeWeeks.length > 0) {
    lines.push(`## Token history — ${formatInt(heatmap.windowTotal)} tokens in window`, "");
    lines.push("| Week of | Tokens | Sessions |");
    lines.push("| --- | ---: | ---: |");
    for (const week of activeWeeks) {
      const first = week?.days?.[0];
      lines.push(`| ${dayLabel(week.start)} | ${formatInt(first?.weekTotal)} | ${formatInt(first?.weekSessions)} |`);
    }
    if (activeWeeks.length < weeks.length) lines.push("", "Weeks without usage are omitted.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function isDashboard(value) {
  const object = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
  const arrayOf = (items, predicate) => Array.isArray(items) && items.every(predicate);
  if (!object(value) || !object(value.config) || !Array.isArray(value.config.sources)
    || !arrayOf(value.years, Number.isInteger) || !object(value.range)
    || !object(value.lifetime) || !object(value.peak) || !object(value.streaks)
    || !object(value.selectedTotals) || !object(value.facets)
    || !Number.isInteger(value.rowCount) || value.rowCount < 0) return false;
  for (const field of ["provider", "model"]) {
    if (!object(value.facets[field]) || !arrayOf(value.facets[field].stats, object)) return false;
  }
  const heatmap = value.heatmap;
  if (!object(heatmap) || !object(heatmap.range) || !isDay(heatmap.range.dataEnd)
    || !arrayOf(heatmap.months, object)
    || !arrayOf(heatmap.weeks, (week) => object(week) && isDay(week.start)
      && arrayOf(week.days, (day) => object(day) && isDay(day.date)))) return false;
  if (!object(value.leaders) || !arrayOf(value.leaders.entries,
    (entry) => object(entry) && typeof entry.name === "string" && object(entry.change))) return false;
  const series = value.modelSeries;
  return series === null || (object(series) && arrayOf(series.models, (model) => typeof model === "string")
    && arrayOf(series.weeks, (week) => object(week) && isDay(week.start) && arrayOf(week.segments, object)));
}

/** Validates the compact payload produced by presenter.mjs before native rendering. */
export function isPresentation(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.kind === "analytics-presentation"
      && value.version === PRESENTATION_VERSION
      && value.snapshot
      && typeof value.snapshot === "object"
      && value.snapshot.config
      && typeof value.snapshot.config === "object"
      && !Array.isArray(value.snapshot.config)
      && Number.isInteger(value.snapshot.rowCount) && value.snapshot.rowCount >= 0
      && (value.dashboard === null || isDashboard(value.dashboard)),
  );
}

/**
 * Snapshot-identity plus small scalar key. Repeated reads from unrelated
 * renders return the exact same derived object, including facet stats.
 */
export function createDashboardCache(compute = deriveDashboard) {
  let cached = null;
  return {
    read(snapshot, options = {}) {
      const resolved = resolvedDashboardOptions(options);
      const key = dashboardKey(snapshot, resolved);
      if (cached && sameDashboardKey(cached.key, key)) return cached.result;
      const result = compute(snapshot, { ...options, ...resolved });
      cached = { key, result };
      return result;
    },
    /** A cache hit only; never runs analytics during a render. */
    peek(snapshot, options = {}) {
      const key = dashboardKey(snapshot, options);
      return cached && sameDashboardKey(cached.key, key) ? cached.result : null;
    },
    invalidate() {
      cached = null;
    },
  };
}

export function heatmapTooltip(cell, mode = "daily") {
  if (!cell || cell.future) return "";
  const exact = formatInt(cell.value);
  if (mode === "weekly") {
    return `Week of ${dayLabel(cell.weekStart, { year: false })}: ${exact} tokens · ${formatInt(cell.weekSessions)} sessions`;
  }
  if (mode === "cumulative") {
    return `Through ${dayLabel(cell.date, { weekday: true })}: ${exact} tokens · ${formatInt(cell.cumulativeSessions)} sessions`;
  }
  return `${dayLabel(cell.date, { weekday: true })}: ${exact} tokens · ${formatInt(cell.dailySessions)} sessions`;
}
