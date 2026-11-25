// Display-only quota math. Missing readings must never become zero usage.
export function accountMachine(focus, spaces) {
  // A peek or composition terminal can belong to a different machine than
  // the space behind it. Terminal addresses are machine-qualified by Herdr.
  if (focus?.terminal) {
    const slash = focus.terminal.indexOf("/");
    return slash < 0 ? null : focus.terminal.slice(0, slash);
  }
  return (spaces.find((space) => space.id === focus?.space) ?? spaces.find((space) => space.active))?.machine ?? null;
}

export function accountSidebarProviders(rows) {
  const active = new Set(rows.flatMap((row) => [row.program?.key, row.app]
    .map((name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""))));
  return [
    { provider: "Claude", label: "Claude Code", keys: ["claude", "claudecode"] },
    { provider: "Codex", label: "Codex", keys: ["codex"] },
    { provider: "Kiro", label: "Kiro", keys: ["kiro", "kirocli"] },
  ].filter((entry) => entry.keys.some((key) => active.has(key)));
}

export function accountDuration(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

export function accountCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function quotaPresentation(window, now, stale = false) {
  const used = window.usedPercent;
  const known = typeof used === "number" && Number.isFinite(used) && used >= 0;
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
  const expired = Number.isFinite(reset) && reset <= now;
  const remaining = known ? Math.max(0, 100 - used) : null;
  return {
    used: known ? `${used.toFixed(1)}% used` : "Usage unavailable",
    remaining: known ? `${remaining.toFixed(1)}%` : "—",
    fill: known ? Math.min(100, used) : 0,
    tone: !known || stale || expired ? "dim" : used >= 100 ? "destructive" : used >= 80 ? "accent" : "done",
    status: !known ? "Unavailable" : expired ? "Awaiting refresh" : stale ? "Last known"
      : used >= 100 ? "Limit reached" : used >= 80 ? "Low headroom" : "",
    reset: !Number.isFinite(reset) ? "Reset time unavailable"
      : expired ? "Reset time passed · refresh to confirm" : `Resets in ${accountDuration(reset - now)}`,
    resetAt: Number.isFinite(reset) ? window.resetsAt : null,
  };
}
