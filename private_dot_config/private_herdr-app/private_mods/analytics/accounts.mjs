// Read-only account quota lookup. Tokens stay in this process, never in output.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const ENDPOINTS = {
  Codex: "https://chatgpt.com/backend-api/wham/usage",
  Claude: "https://api.anthropic.com/api/oauth/usage",
  Kiro: "https://codewhisperer.us-east-1.amazonaws.com/",
};
const KIRO_ENDPOINTS = {
  "us-east-1": ENDPOINTS.Kiro,
  "eu-central-1": "https://q.eu-central-1.amazonaws.com/",
};

class UsageError extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function iso(value) {
  if (value == null) return null;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function window(label, value, provider, scope = "main") {
  const usedPercent = number(provider === "Codex" ? value?.used_percent : value?.utilization);
  if (usedPercent === null) return null;
  return { label, scope, usedPercent, resetsAt: iso(provider === "Codex" ? value.reset_at : value.resets_at) };
}

function durationLabel(value, fallback) {
  const seconds = number(value?.limit_window_seconds);
  if (!seconds) return fallback;
  if (seconds === 18000) return "Session · 5 hours";
  if (seconds === 604800) return "Weekly · 7 days";
  return seconds % 86400 === 0 ? `${seconds / 86400} days` : `${seconds / 3600} hours`;
}

export function parseUsage(provider, data) {
  if (provider === "Kiro") return parseKiroUsage(data);
  let windows;
  if (provider === "Codex") {
    const limits = data?.rate_limit;
    windows = [
      window(durationLabel(limits?.primary_window, "Primary"), limits?.primary_window, provider),
      window(durationLabel(limits?.secondary_window, "Secondary"), limits?.secondary_window, provider),
    ];
    for (const extra of Array.isArray(data?.additional_rate_limits) ? data.additional_rate_limits : []) {
      const label = String(extra?.limit_name ?? extra?.metered_feature ?? "Additional").slice(0, 80);
      windows.push(window(`${label} · ${durationLabel(extra?.rate_limit?.primary_window, "Primary")}`, extra?.rate_limit?.primary_window, provider, "additional"));
      windows.push(window(`${label} · ${durationLabel(extra?.rate_limit?.secondary_window, "Secondary")}`, extra?.rate_limit?.secondary_window, provider, "additional"));
    }
  } else {
    windows = [
      window("Session · 5 hours", data?.five_hour, provider),
      window("Weekly · 7 days", data?.seven_day, provider),
      window("Sonnet · 7 days", data?.seven_day_sonnet, provider, "additional"),
      window("Opus · 7 days", data?.seven_day_opus, provider, "additional"),
      window("OAuth apps · 7 days", data?.seven_day_oauth_apps, provider, "additional"),
    ];
  }
  windows = windows.filter(Boolean);
  if (!windows.length) throw new UsageError("The API returned no supported usage windows.");
  // Whitelist fields; no raw response, account identifier or token is retained.
  const plan = provider === "Codex" && typeof data?.plan_type === "string"
    ? data.plan_type.replace(/_/g, " ").slice(0, 80) : null;
  return { provider, status: "ok", windows, ...(plan ? { plan } : {}) };
}

function parseKiroUsage(data) {
  const credits = (Array.isArray(data?.usageBreakdownList) ? data.usageBreakdownList : [])
    .filter((entry) => entry?.resourceType === "CREDIT");
  if (credits.length !== 1) throw new UsageError("Kiro returned no unambiguous credit balance.");
  const credit = credits[0];
  const limit = number(credit.usageLimitWithPrecision);
  const total = number(credit.currentUsageWithPrecision);
  const overage = number(credit.currentOveragesWithPrecision ?? 0);
  if (limit === null || total === null || overage === null || overage > total) {
    throw new UsageError("Kiro returned an invalid credit balance.");
  }
  const reset = number(credit.nextDateReset ?? data.nextDateReset);
  const resetsAt = reset >= 1000000000 && reset <= 4102444800 ? iso(reset) : null;
  const windows = [];
  const creditWindow = (label, used, allowance, scope) => ({
    label, scope, usedPercent: used / allowance * 100, resetsAt,
    usedCredits: used, limitCredits: allowance,
  });
  const bonuses = credit.bonuses;
  const hasBonus = bonuses != null && (!Array.isArray(bonuses) || bonuses.length > 0);
  const planUsed = total - overage;
  let note = null;
  if (hasBonus) note = "Monthly plan usage unavailable: Kiro combines plan and bonus credits in this response.";
  else if (limit === 0) note = "Kiro did not provide a positive monthly plan allowance.";
  else if (planUsed > limit) throw new UsageError("Kiro returned an inconsistent monthly credit balance.");
  else windows.push(creditWindow("Monthly credits", planUsed, limit, "main"));
  const overageStatus = data?.overageConfiguration?.overageStatus;
  const cap = number(credit.overageCapWithPrecision);
  if (overageStatus === "ENABLED" && cap > 0) {
    windows.push(creditWindow("Overage credits", overage, cap, "additional"));
  }
  const overageNote = overageStatus === "DISABLED" ? "Overage is disabled."
    : overageStatus === "ENABLED" && !(cap > 0) ? "Overage is enabled; its allowance is unavailable." : null;
  return { provider: "Kiro", status: "ok", windows, note: [note, overageNote].filter(Boolean).join(" ") };
}

async function readKiroState(file) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 250");
    const decode = (row) => {
      if (!row) return null;
      const value = JSON.parse(typeof row.value === "string" ? row.value : Buffer.from(row.value).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Kiro state");
      return value;
    };
    return {
      token: decode(db.prepare("SELECT value FROM auth_kv WHERE key = ?").get("kirocli:odic:token")),
      profile: decode(db.prepare("SELECT value FROM state WHERE key = ?").get("api.codewhisperer.profile")),
    };
  } finally { db.close(); }
}

async function kiroCredentials(io) {
  const dataDir = io.env.KIRO_DATA_DIR || (io.platform === "darwin"
    ? path.join(io.home, "Library/Application Support/kiro-cli")
    : path.join(io.env.XDG_DATA_HOME || path.join(io.home, ".local/share"), "kiro-cli"));
  let state;
  try { state = await io.readKiroState(path.join(dataDir, "data.sqlite3")); }
  catch { throw new UsageError("Kiro CLI login could not be read. Open Kiro CLI and sign in."); }
  const token = state?.token;
  if (typeof token?.access_token !== "string" || !token.access_token.trim()) {
    throw new UsageError("No Kiro CLI login found. Open Kiro CLI and sign in.");
  }
  if (token.expires_at && Date.parse(token.expires_at) <= io.now()) {
    throw new UsageError("Kiro login has expired. Open Kiro CLI to renew it.");
  }
  let endpoint = ENDPOINTS.Kiro;
  const profileArn = state.profile?.arn;
  if (state.profile !== null) {
    const match = typeof profileArn === "string"
      ? /^arn:aws:codewhisperer:([a-z0-9-]+):[0-9]{12}:profile\/[^\s\x00-\x1f]+$/.exec(profileArn) : null;
    if (!match || !Object.hasOwn(KIRO_ENDPOINTS, match[1])) {
      throw new UsageError("Kiro CLI profile is invalid or uses an unsupported region.");
    }
    endpoint = KIRO_ENDPOINTS[match[1]];
  }
  return { token: token.access_token, endpoint, profileArn };
}

async function jsonFile(file, io) {
  try { return JSON.parse(await io.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new UsageError("The local credentials could not be read. Sign in again with the CLI.");
  }
}

async function credentials(provider, io) {
  if (provider === "Kiro") return kiroCredentials(io);
  if (provider === "Codex") {
    const data = await jsonFile(path.join(io.env.CODEX_HOME || path.join(io.home, ".codex"), "auth.json"), io);
    const tokens = data?.tokens;
    if (!tokens?.access_token) throw new UsageError("No Codex OAuth login found. Run codex login.");
    // JWT decoding is only an expiry hint, never signature verification.
    try {
      const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url"));
      if (number(claims.exp) !== null && claims.exp * 1000 <= io.now()) {
        throw new UsageError("Codex login has expired. Open Codex to renew it.");
      }
    } catch (error) { if (error instanceof UsageError) throw error; }
    return { token: tokens.access_token, accountId: tokens.account_id };
  }
  const configDir = io.env.CLAUDE_CONFIG_DIR || path.join(io.home, ".claude");
  let data = null;
  const defaultKeychain = io.platform === "darwin" && !io.env.CLAUDE_CONFIG_DIR;
  // A legacy file can remain after Claude moves its current login to Keychain.
  if (defaultKeychain) {
    try {
      const result = await io.execFile("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 5000, maxBuffer: 128 * 1024 });
      data = JSON.parse(result.stdout);
    } catch { /* Claude also uses a file when Keychain is unavailable. */ }
  }
  if (!data) data = await jsonFile(path.join(configDir, ".credentials.json"), io);
  if (!data && defaultKeychain) throw new UsageError("Claude login is unavailable in Keychain or its fallback file. Open Claude Code to sign in or allow Keychain access.");
  const oauth = data?.claudeAiOauth;
  if (!oauth?.accessToken) throw new UsageError("No Claude OAuth login found. Open Claude Code to sign in.");
  if (number(oauth.expiresAt) !== null && oauth.expiresAt <= io.now()) {
    throw new UsageError("Claude login has expired. Open Claude Code to renew it.");
  }
  return { token: oauth.accessToken };
}

async function fetchUsage(provider, auth, io) {
  const headers = { Authorization: `Bearer ${auth.token}`, Accept: "application/json", "User-Agent": "herdr-analytics" };
  if (provider === "Claude") headers["anthropic-beta"] = "oauth-2025-04-20";
  if (provider === "Codex" && auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
  if (provider === "Kiro") {
    headers["Content-Type"] = "application/x-amz-json-1.0";
    headers["X-Amz-Target"] = "AmazonCodeWhispererService.GetUsageLimits";
  }
  const response = await io.fetch(auth.endpoint ?? ENDPOINTS[provider], {
    method: provider === "Kiro" ? "POST" : "GET", headers, redirect: "error", signal: AbortSignal.timeout(10_000),
    ...(provider === "Kiro" ? { body: JSON.stringify(auth.profileArn ? { profileArn: auth.profileArn } : {}) } : {}),
  });
  if ([401, 403].includes(response.status)) throw new UsageError("Account access was denied. Renew the CLI login and check account permissions.");
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const seconds = Number(retry);
    const retryAfterMs = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - io.now();
    throw new UsageError("The account API is rate limited. Waiting before retrying.", Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 5 * 60 * 1000);
  }
  if (!response.ok) throw new UsageError(`Account API unavailable (HTTP ${response.status}).`);
  return parseUsage(provider, await response.json());
}

export async function collectAccounts(options = {}, dependencies = {}) {
  // Explicit opt-in also protects accidental direct invocation of the helper.
  if (options.localOnly !== false) return { version: 1, entries: [] };
  const io = {
    home: os.homedir(), env: process.env, platform: process.platform,
    readFile, readKiroState, execFile: execFileAsync, fetch: globalThis.fetch, now: Date.now,
    ...dependencies,
  };
  let retryAfterMs = 0;
  const entries = await Promise.all(Object.keys(ENDPOINTS).map(async (provider) => {
    try { return await fetchUsage(provider, await credentials(provider, io), io); }
    catch (error) {
      retryAfterMs = Math.max(retryAfterMs, error instanceof UsageError ? error.retryAfterMs : 0);
      return { provider, status: "error", message: error instanceof UsageError ? error.message : "Account lookup failed (network or invalid response)." };
    }
  }));
  return { version: 1, entries, retryAfterMs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await collectAccounts({ localOnly: !process.argv.includes("--allow-network") });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
