import {
  isPlainObject,
  nonEmptyString,
} from "./util.mjs";

// Custom source mapping (declarative; no executable code):
//   mapping: {
//     session: field, timestamp: field,
//     messageId?: field, project?: field, model?: field, provider?: field,
//     role?: field, roles?: string[], include?: [{path, equals|exists}],
//     usage: {input?, output?, cacheRead?, cacheWrite?, reasoning?},
//     taskDurationMs?: field, harness?: string
//   }
// field = "dot.path" | {path, default?} | {literal}.
// Paths read own object keys and numeric array indexes. The custom usage
// fields are already canonical: input is uncached, output includes reasoning,
// reasoning is a subset, and total is computed by the collector.

const PI_SOURCE = Object.freeze({
  id: "pi",
  label: "Pi",
  adapter: "pi",
  enabled: true,
  roots: Object.freeze(["~/.pi/agent/sessions"]),
});
const CODEX_SOURCE = Object.freeze({
  id: "codex",
  label: "Codex",
  adapter: "codex",
  enabled: true,
  roots: Object.freeze(["~/.codex/sessions", "~/.codex/archived_sessions"]),
});
const OPENCODE_SOURCE = Object.freeze({
  id: "opencode",
  label: "OpenCode",
  adapter: "opencode",
  enabled: true,
  roots: Object.freeze(["~/.local/share/opencode"]),
});
const CLAUDE_SOURCE = Object.freeze({
  id: "claude",
  label: "Claude Code",
  adapter: "claude",
  enabled: true,
  roots: Object.freeze(["~/.claude/projects"]),
});

const ANTIGRAVITY_SOURCE = Object.freeze({
  id: "antigravity",
  label: "Antigravity",
  adapter: "antigravity",
  enabled: true,
  roots: Object.freeze([
    "~/.gemini/antigravity-cli/conversations",
    "~/.gemini/antigravity-cli/brain",
  ]),
});

export const DEFAULT_CONFIG = Object.freeze({
  profile: { name: "Developer", handle: "", avatar: "" },
  palette: "blue",
  includeCache: true,
  weekStartsOn: 0,
  refreshSeconds: 60,
  sources: Object.freeze([PI_SOURCE, CODEX_SOURCE, OPENCODE_SOURCE, CLAUDE_SOURCE, ANTIGRAVITY_SOURCE]),
});

export const BUILTIN_ADAPTERS = new Set(["pi", "claude", "codex", "opencode", "antigravity"]);
export const ADAPTERS = new Set([...BUILTIN_ADAPTERS, "custom"]);

const TOP_KEYS = new Set([
  "profile",
  "palette",
  "includeCache",
  "weekStartsOn",
  "refreshSeconds",
  "sources",
]);
const PROFILE_KEYS = new Set(["name", "handle", "avatar"]);
const SOURCE_KEYS = new Set(["id", "label", "adapter", "enabled", "roots", "mapping"]);
const MAPPING_KEYS = new Set([
  "session",
  "timestamp",
  "messageId",
  "project",
  "model",
  "provider",
  "role",
  "roles",
  "include",
  "usage",
  "taskDurationMs",
  "harness",
]);
const USAGE_KEYS = new Set([
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
]);
const FIELD_KEYS = new Set(["path", "literal", "default"]);

function fail(message) {
  throw new Error(`invalid config: ${message}`);
}

function primitive(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validAvatarPath(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/[\u0000-\u001f\\]/.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false; // network/data URLs
  if (value.startsWith("/") || value.startsWith("~")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function normalizeFieldSpec(value, label, { required = false } = {}) {
  if (value === undefined) {
    if (required) fail(`${label} is required`);
    return undefined;
  }
  if (typeof value === "string") {
    if (!nonEmptyString(value)) fail(`${label} must be a non-empty path`);
    return { path: value };
  }
  if (!isPlainObject(value)) fail(`${label} must be a path string or field object`);
  for (const key of Object.keys(value)) {
    if (!FIELD_KEYS.has(key)) fail(`${label} has unknown field ${key}`);
  }
  const hasPath = Object.hasOwn(value, "path");
  const hasLiteral = Object.hasOwn(value, "literal");
  if (hasPath === hasLiteral) fail(`${label} needs exactly one of path or literal`);
  if (hasPath && !nonEmptyString(value.path)) fail(`${label}.path must be non-empty`);
  if (hasLiteral && !primitive(value.literal)) fail(`${label}.literal must be a primitive`);
  if (Object.hasOwn(value, "default") && !primitive(value.default)) {
    fail(`${label}.default must be a primitive`);
  }
  if (hasLiteral && Object.hasOwn(value, "default")) {
    fail(`${label} cannot combine literal and default`);
  }
  const out = hasPath
    ? { path: value.path }
    : { literal: value.literal };
  if (Object.hasOwn(value, "default")) out.default = value.default;
  return out;
}

function normalizeMapping(value, sourceId) {
  if (!isPlainObject(value)) fail(`source ${sourceId} custom mapping must be an object`);
  for (const key of Object.keys(value)) {
    if (!MAPPING_KEYS.has(key)) fail(`source ${sourceId} mapping has unknown field ${key}`);
  }
  const mapping = {};
  mapping.session = normalizeFieldSpec(value.session, `source ${sourceId} mapping.session`, {
    required: true,
  });
  mapping.timestamp = normalizeFieldSpec(
    value.timestamp,
    `source ${sourceId} mapping.timestamp`,
    { required: true },
  );
  for (const key of ["messageId", "project", "model", "provider", "role", "taskDurationMs"]) {
    const spec = normalizeFieldSpec(value[key], `source ${sourceId} mapping.${key}`);
    if (spec) mapping[key] = spec;
  }
  if (value.roles !== undefined) {
    if (!Array.isArray(value.roles) || value.roles.length === 0) {
      fail(`source ${sourceId} mapping.roles must be a non-empty array`);
    }
    if (mapping.role === undefined) {
      fail(`source ${sourceId} mapping.roles needs mapping.role`);
    }
    mapping.roles = value.roles.map((role, index) => {
      if (!nonEmptyString(role)) {
        fail(`source ${sourceId} mapping.roles[${index}] must be a non-empty string`);
      }
      return role;
    });
  }
  if (value.include !== undefined) {
    if (!Array.isArray(value.include)) {
      fail(`source ${sourceId} mapping.include must be an array`);
    }
    mapping.include = value.include.map((condition, index) => {
      if (!isPlainObject(condition)) {
        fail(`source ${sourceId} mapping.include[${index}] must be an object`);
      }
      const allowed = new Set(["path", "equals", "exists"]);
      for (const key of Object.keys(condition)) {
        if (!allowed.has(key)) {
          fail(`source ${sourceId} mapping.include[${index}] has unknown field ${key}`);
        }
      }
      if (!nonEmptyString(condition.path)) {
        fail(`source ${sourceId} mapping.include[${index}].path must be non-empty`);
      }
      const keyCount =
        (Object.hasOwn(condition, "equals") ? 1 : 0) +
        (Object.hasOwn(condition, "exists") ? 1 : 0);
      if (keyCount !== 1) {
        fail(`source ${sourceId} mapping.include[${index}] needs equals or exists`);
      }
      if (Object.hasOwn(condition, "equals") && !primitive(condition.equals)) {
        fail(`source ${sourceId} mapping.include[${index}].equals must be a primitive`);
      }
      if (Object.hasOwn(condition, "exists") && typeof condition.exists !== "boolean") {
        fail(`source ${sourceId} mapping.include[${index}].exists must be boolean`);
      }
      return Object.hasOwn(condition, "equals")
        ? { path: condition.path, equals: condition.equals }
        : { path: condition.path, exists: condition.exists };
    });
  }
  if (!isPlainObject(value.usage)) {
    fail(`source ${sourceId} mapping.usage must be an object`);
  }
  for (const key of Object.keys(value.usage)) {
    if (!USAGE_KEYS.has(key)) {
      fail(`source ${sourceId} mapping.usage has unknown field ${key}`);
    }
  }
  mapping.usage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning"]) {
    if (value.usage[key] === undefined) continue;
    mapping.usage[key] = normalizeFieldSpec(
      value.usage[key],
      `source ${sourceId} mapping.usage.${key}`,
      { required: true },
    );
  }
  if (Object.keys(mapping.usage).length === 0) {
    fail(`source ${sourceId} mapping.usage must map at least one token field`);
  }
  if (value.harness !== undefined) {
    if (!nonEmptyString(value.harness)) {
      fail(`source ${sourceId} mapping.harness must be a non-empty string`);
    }
    mapping.harness = value.harness;
  }
  return mapping;
}

function normalizeSource(value, index) {
  if (!isPlainObject(value)) fail(`sources[${index}] must be an object`);
  for (const key of Object.keys(value)) {
    if (!SOURCE_KEYS.has(key)) fail(`sources[${index}] has unknown field ${key}`);
  }
  if (!nonEmptyString(value.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)) {
    fail(`sources[${index}].id must match [A-Za-z0-9][A-Za-z0-9_-]*`);
  }
  if (!nonEmptyString(value.label)) fail(`source ${value.id}.label must be non-empty`);
  if (!ADAPTERS.has(value.adapter)) {
    fail(`source ${value.id}.adapter must be one of: ${[...ADAPTERS].join(", ")}`);
  }
  if (!Array.isArray(value.roots)) fail(`source ${value.id}.roots must be an array`);
  const roots = value.roots.map((root, rootIndex) => {
    if (!nonEmptyString(root) || root.includes("\u0000")) {
      fail(`source ${value.id}.roots[${rootIndex}] must be a non-empty path`);
    }
    return root;
  });
  const enabled = value.enabled === undefined ? true : value.enabled;
  if (typeof enabled !== "boolean") fail(`source ${value.id}.enabled must be boolean`);
  const source = {
    id: value.id,
    label: value.label,
    adapter: value.adapter,
    enabled,
    roots,
  };
  if (value.adapter === "custom") {
    source.mapping = normalizeMapping(value.mapping, value.id);
  } else if (value.mapping !== undefined) {
    fail(`source ${value.id}.mapping is only valid for the custom adapter`);
  }
  return source;
}

export function normalizeConfig(input) {
  if (!isPlainObject(input)) fail("config must be a JSON object");
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.has(key)) fail(`unknown field ${key}`);
  }
  const profileInput = input.profile === undefined ? DEFAULT_CONFIG.profile : input.profile;
  if (!isPlainObject(profileInput)) fail("profile must be an object");
  for (const key of Object.keys(profileInput)) {
    if (!PROFILE_KEYS.has(key)) fail(`profile has unknown field ${key}`);
  }
  const profile = {
    name:
      profileInput.name === undefined
        ? DEFAULT_CONFIG.profile.name
        : profileInput.name,
    handle:
      profileInput.handle === undefined ? "" : profileInput.handle,
    avatar:
      profileInput.avatar === undefined ? "" : profileInput.avatar,
  };
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value !== "string") fail(`profile.${key} must be a string`);
  }
  if (!validAvatarPath(profile.avatar)) {
    fail(
      "profile.avatar must be an app-relative path without URLs, absolute paths, or traversal",
    );
  }

  const palette = input.palette === undefined ? DEFAULT_CONFIG.palette : input.palette;
  if (!["blue", "green", "purple"].includes(palette)) {
    fail("palette must be blue, green, or purple");
  }
  const includeCache =
    input.includeCache === undefined ? DEFAULT_CONFIG.includeCache : input.includeCache;
  if (typeof includeCache !== "boolean") fail("includeCache must be boolean");
  const weekStartsOn =
    input.weekStartsOn === undefined ? DEFAULT_CONFIG.weekStartsOn : input.weekStartsOn;
  if (weekStartsOn !== 0 && weekStartsOn !== 1) {
    fail("weekStartsOn must be 0 (Sunday) or 1 (Monday)");
  }
  const refreshSeconds =
    input.refreshSeconds === undefined
      ? DEFAULT_CONFIG.refreshSeconds
      : input.refreshSeconds;
  if (
    !Number.isInteger(refreshSeconds) ||
    refreshSeconds < 30 ||
    refreshSeconds > 3600
  ) {
    fail("refreshSeconds must be an integer from 30 to 3600");
  }

  const sourceInputs =
    input.sources === undefined ? DEFAULT_CONFIG.sources : input.sources;
  if (!Array.isArray(sourceInputs)) fail("sources must be an array");
  const sources = sourceInputs.map(normalizeSource);
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) fail(`duplicate source id ${source.id}`);
    ids.add(source.id);
  }

  return {
    profile,
    palette,
    includeCache,
    weekStartsOn,
    refreshSeconds,
    sources,
  };
}

function sameSource(left, right) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.adapter === right.adapter &&
    left.enabled === right.enabled &&
    left.roots.length === right.roots.length &&
    left.roots.every((root, index) => root === right.roots[index])
  );
}

export function migrateLoadedConfig(config) {
  // Upgrade only untouched previous defaults; customized sources stay as saved.
  const untouchedDefaults = [3, 4].includes(config.sources.length) &&
    config.sources.every((source, index) => sameSource(source, DEFAULT_CONFIG.sources[index]));
  if (!untouchedDefaults) {
    return { config, migrated: false };
  }
  return {
    config: {
      ...config,
      sources: DEFAULT_CONFIG.sources.map((source) => ({ ...source, roots: [...source.roots] })),
    },
    migrated: true,
  };
}

export function sourcesSignature(config) {
  return JSON.stringify(
    config.sources.map((source) => ({
      id: source.id,
      adapter: source.adapter,
      enabled: source.enabled,
      roots: source.roots,
      mapping: source.mapping ?? null,
    })),
  );
}

export function defaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG);
}
