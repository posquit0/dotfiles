import { antigravityConversation } from "./antigravity.mjs";
import {
  MAX_TURN_MS,
  asString,
  hashKey,
  isPlainObject,
  localDay,
  normalizeTokens,
  parseTimestamp,
  toNonNegInt,
} from "./util.mjs";
import {
  taskKeyFor as makeTaskKey,
  dedupKeyFor as makeDedupKey,
  taskKeyFor,
} from "./store.mjs";

function metaFor(harness, session, timestamp, project, provider, model) {
  return {
    day: localDay(timestamp),
    session,
    harness,
    provider: asString(provider),
    model: asString(model),
    project: asString(project),
  };
}

function spanMs(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.min(end - start, MAX_TURN_MS);
}

function historyFor(state, session) {
  if (!isPlainObject(state.sessions)) state.sessions = {};
  let history = state.sessions[session];
  if (!isPlainObject(history)) {
    history = {
      turnStart: null,
      turnFirst: null,
      lastRow: null,
    };
    state.sessions[session] = history;
  }
  return history;
}

function rememberLastRow(history, result) {
  if (!result) return;
  history.lastRow = { fileId: result.fileId, rowIdx: result.rowIdx };
}

function emitTask(ctx, history, session, key, duration, exact) {
  if (!history?.lastRow || !Number.isFinite(duration) || duration <= 0) return;
  ctx.addTask(
    history.lastRow.fileId,
    history.lastRow.rowIdx,
    key,
    duration,
    session,
    exact,
  );
}

// ---------------------------------------------------------------------------
// Pi

function piMainSession(state, ctx) {
  if (state.header?.id) return `pi:${state.header.id}`;
  return `pi-file:${ctx.file.path}`;
}

function piSubagentSession(record, ctx) {
  const runId = asString(record.runId, "");
  const childIndex = Number.isInteger(record.childIndex) ? record.childIndex : 0;
  if (runId) return `pi-sub:${runId}:${childIndex}`;
  return `pi-file:${ctx.file.path}`;
}

function piUsageCarrier(record, ctx) {
  const usage = isPlainObject(record.usage) ? record.usage : null;
  if (!usage) return;
  const state = ctx.state;
  const session = piMainSession(state, ctx);
  const timestamp = parseTimestamp(
    record.timestamp ?? state.header?.timestamp,
  );
  if (timestamp === null) {
    ctx.warn(`Pi ${record.type} record has no usable timestamp; skipped`);
    return;
  }
  const tokens = normalizeTokens({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning,
  });
  if (!tokens.nonzero) return;
  const identity = record.id ?? `line:${ctx.lineHash}`;
  ctx.addUsage(
    metaFor(
      "pi",
      session,
      timestamp,
      asString(state.header?.cwd, "unknown"),
      record.provider,
      record.model,
    ),
    tokens,
    makeDedupKey("pi", record.type, identity, timestamp),
  );
}

function piTiming(record, ctx, session, timestamp, isFinal, finalIdentity) {
  const history = historyFor(ctx.state, session);
  if (record.role === "user") {
    history.turnStart = timestamp;
    history.turnFirst = null;
    history.lastRow = null;
    return;
  }
  if (record.role !== "assistant") return;
  if (!history.turnFirst) history.turnFirst = timestamp;
  if (!isFinal) return;
  const start = history.turnStart ?? history.turnFirst;
  emitTask(
    ctx,
    history,
    session,
    taskKeyFor("pi", "span", finalIdentity),
    spanMs(start, timestamp),
    false,
  );
  history.turnStart = null;
  history.turnFirst = null;
}

function parsePi(record, ctx) {
  if (!isPlainObject(record)) return;
  const state = ctx.state;

  if (record.type === "session") {
    state.header = {
      id: asString(record.id, ""),
      cwd: asString(record.cwd, ""),
      timestamp: record.timestamp,
      parentSession: asString(record.parentSession, ""),
    };
    state.headerTimestamp = parseTimestamp(record.timestamp);
    return;
  }

  // Pi usage carriers outside assistant messages: cache warming, compaction,
  // and branch-summary usage all contribute to Pi's session totals.
  if (
    record.type === "usage" ||
    record.type === "compaction" ||
    record.type === "branch_summary"
  ) {
    piUsageCarrier(record, ctx);
    return;
  }

  // Pi's own session files: message + message.usage.
  if (record.type === "message" && isPlainObject(record.message)) {
    const message = record.message;
    const role = asString(message.role, "");
    const session = piMainSession(state, ctx);
    const timestamp = parseTimestamp(
      record.timestamp ?? message.timestamp ?? state.header?.timestamp,
    );
    const project = asString(state.header?.cwd, "unknown");
    const provider = asString(message.provider);
    const model = asString(message.model);
    const stopReason = asString(message.stopReason, "");
    const failed =
      stopReason === "error" ||
      stopReason === "aborted" ||
      Boolean(message.errorMessage);
    const final = stopReason === "stop" && !failed;
    const identity =
      record.id ??
      message.responseId ??
      `line:${session}:${ctx.lineHash}`;

    if (role === "user") {
      if (timestamp !== null) piTiming({ role }, ctx, session, timestamp, false, "");
      return;
    }
    if (role === "toolResult") {
      // Tool extensions may report nested-model usage directly. Count the
      // reported event without opening/closing the surrounding assistant turn.
      piUsageCarrier({
        type: "toolResult", usage: message.usage,
        id: record.id ?? message.toolCallId ?? message.responseId,
        timestamp: record.timestamp ?? message.timestamp,
        provider: message.provider, model: message.model,
      }, ctx);
      return;
    }
    if (role !== "assistant") return;
    if (timestamp === null) {
      ctx.warn("Pi assistant record has no usable timestamp; skipped");
      return;
    }

    const history = historyFor(state, session);
    if (!history.turnFirst) history.turnFirst = timestamp;
    const usage = isPlainObject(message.usage) ? message.usage : null;
    if (usage) {
      const tokens = normalizeTokens({
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        reasoning: usage.reasoning,
      });
      if (tokens.nonzero) {
        const result = ctx.addUsage(
          metaFor("pi", session, timestamp, project, provider, model),
          tokens,
          makeDedupKey("pi", identity, timestamp, provider, model),
        );
        rememberLastRow(history, result);
      }
    }
    if (final) {
      piTiming(
        { role: "assistant" },
        ctx,
        session,
        timestamp,
        true,
        hashKey("pi-final", identity, timestamp, provider, model),
      );
    }
    return;
  }

  // Pi sub-agent transcript artifacts. They are JSONL under the same root but
  // put usage and role at the top level and have no session header.
  if (record.recordType === "message" && record.role !== undefined) {
    const role = asString(record.role, "");
    const session = piSubagentSession(record, ctx);
    const timestamp = parseTimestamp(record.timestamp ?? record.ts);
    const project = asString(record.cwd, "unknown");
    const provider = asString(
      record.provider ?? record.message?.provider,
      "unknown",
    );
    const model = asString(record.model ?? record.message?.model, "unknown");
    const stopReason = asString(record.stopReason, "");
    const failed =
      stopReason === "error" ||
      stopReason === "aborted" ||
      Boolean(record.errorMessage);
    const final = stopReason === "stop" && !failed;
    const identity =
      record.message?.responseId ??
      record.responseId ??
      `line:${session}:${ctx.lineHash}`;

    if (role === "user") {
      if (timestamp !== null) piTiming({ role }, ctx, session, timestamp, false, "");
      return;
    }
    if (role !== "assistant") return;
    if (timestamp === null) {
      ctx.warn("Pi sub-agent assistant record has no usable timestamp; skipped");
      return;
    }
    const history = historyFor(state, session);
    if (!history.turnFirst) history.turnFirst = timestamp;
    const usage = isPlainObject(record.usage) ? record.usage : null;
    if (usage) {
      const tokens = normalizeTokens({
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        reasoning: usage.reasoning,
      });
      if (tokens.nonzero) {
        const result = ctx.addUsage(
          metaFor("pi", session, timestamp, project, provider, model),
          tokens,
          makeDedupKey("pi", identity, timestamp, provider, model),
        );
        rememberLastRow(history, result);
      }
    }
    if (final) {
      piTiming(
        { role: "assistant" },
        ctx,
        session,
        timestamp,
        true,
        hashKey("pi-final", identity, timestamp, provider, model),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Code

function claudeSession(record, ctx) {
  const id = asString(record.sessionId ?? record.session_id, "");
  if (id) return `claude:${id}`;
  return `claude-file:${ctx.file.path}`;
}

function claudePrompt(record) {
  return (
    record.type === "user" &&
    !record.sourceToolUseID &&
    !record.toolUseResult &&
    !record.isMeta
  );
}

function claudeReasoning(usage) {
  const details = usage.output_tokens_details;
  if (isPlainObject(details) && Number.isFinite(details.thinking_tokens)) {
    return toNonNegInt(details.thinking_tokens);
  }
  return 0;
}

function claudeCacheWrite(usage) {
  if (Number.isFinite(usage.cache_creation_input_tokens)) {
    return toNonNegInt(usage.cache_creation_input_tokens);
  }
  if (isPlainObject(usage.cache_creation)) {
    let sum = 0;
    for (const value of Object.values(usage.cache_creation)) {
      if (Number.isFinite(value) && value > 0) sum += value;
    }
    return toNonNegInt(sum);
  }
  return 0;
}

function parseClaude(record, ctx) {
  if (!isPlainObject(record)) return;
  const state = ctx.state;
  const session = claudeSession(record, ctx);
  const timestamp = parseTimestamp(record.timestamp) ?? state.fallbackTimestamp ?? null;
  if (timestamp !== null && state.fallbackTimestamp === undefined) {
    state.fallbackTimestamp = timestamp;
  }
  const history = historyFor(state, session);

  if (claudePrompt(record)) {
    if (timestamp !== null) {
      history.turnStart = timestamp;
      history.turnFirst = null;
      history.lastRow = null;
    }
    return;
  }

  if (record.type === "system" && record.subtype === "turn_duration") {
    const duration = Number.isFinite(record.durationMs)
      ? toNonNegInt(record.durationMs)
      : 0;
    if (duration <= 0) return;
    const removed = ctx.removeLatestFallback(session);
    if (!history.lastRow && removed) {
      history.lastRow = { fileId: removed.fileId, rowIdx: removed.rowIdx };
    }
    emitTask(
      ctx,
      history,
      session,
      taskKeyFor(
        "claude",
        "turn-duration",
        record.parentUuid ?? record.uuid ?? record.timestamp,
      ),
      duration,
      true,
    );
    return;
  }

  if (record.type !== "assistant" || !isPlainObject(record.message)) return;
  if (timestamp === null) {
    ctx.warn("Claude assistant record has no usable timestamp; skipped");
    return;
  }
  const message = record.message;
  const usage = isPlainObject(message.usage) ? message.usage : null;
  const model = asString(message.model);
  const provider = asString(message.provider, "anthropic");
  const project = asString(record.cwd, "unknown");
  const identity = message.id ?? record.uuid ?? `line:${session}:${ctx.lineHash}`;

  if (!history.turnFirst) history.turnFirst = timestamp;
  if (usage) {
    const tokens = normalizeTokens({
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: claudeCacheWrite(usage),
      reasoning: claudeReasoning(usage),
    });
    if (tokens.nonzero) {
      const result = ctx.addUsage(
        metaFor("claude", session, timestamp, project, provider, model),
        tokens,
        makeDedupKey("claude", identity),
      );
      rememberLastRow(history, result);
    }
  }

  const stop = asString(message.stop_reason, "");
  const failed =
    Boolean(record.isApiErrorMessage) ||
    Boolean(record.error) ||
    Number.isFinite(record.apiErrorStatus) ||
    stop === "error";
  const final =
    !failed && ["end_turn", "stop_sequence", "max_tokens", "stop"].includes(stop);
  if (final) {
    const start = history.turnStart ?? history.turnFirst;
    emitTask(
      ctx,
      history,
      session,
      taskKeyFor("claude", "span", identity),
      spanMs(start, timestamp),
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// Codex

function codexSession(state, ctx) {
  if (state.session) return `codex:${state.session}`;
  return `codex-file:${ctx.file.path}`;
}

function codexRecordSession(state, ctx, payload) {
  const threadId = asString(
    payload.thread_id ??
      payload.session_id ??
      payload.threadId ??
      payload.sessionId,
    "",
  );
  if (threadId) return `codex:${threadId}`;
  return codexSession(state, ctx);
}

function codexContext(state, turnId) {
  if (!isPlainObject(state.turns)) state.turns = {};
  if (turnId && isPlainObject(state.turns[turnId])) return state.turns[turnId];
  return {
    model: state.model,
    provider: state.provider,
    project: state.project,
    lastRow: state.lastRow ?? null,
  };
}

function codexNormalized(raw) {
  const inputRaw = toNonNegInt(raw.input_tokens);
  const cached = toNonNegInt(raw.cached_input_tokens);
  const cacheWrite = toNonNegInt(raw.cache_write_input_tokens);
  return normalizeTokens({
    input: Math.max(0, inputRaw - cached - cacheWrite),
    output: raw.output_tokens,
    cacheRead: cached,
    cacheWrite,
    reasoning: raw.reasoning_output_tokens,
  });
}

const CODEX_TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const CODEX_TWIN_WINDOW_MS = 5 * 60 * 1000;

function codexZeroTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function codexTokenVector(tokens) {
  return CODEX_TOKEN_FIELDS.map((field) => toNonNegInt(tokens[field]));
}

function codexSameTokens(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function codexCloseInTime(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(left - right) <= CODEX_TWIN_WINDOW_MS;
}

function codexPendingTokens(state) {
  if (!isPlainObject(state.modernPending)) state.modernPending = codexZeroTokens();
  for (const field of CODEX_TOKEN_FIELDS) {
    state.modernPending[field] = toNonNegInt(state.modernPending[field]);
  }
  return state.modernPending;
}

function codexAddPending(state, tokens) {
  const pending = codexPendingTokens(state);
  for (const field of CODEX_TOKEN_FIELDS) {
    pending[field] = toNonNegInt(pending[field] + tokens[field]);
  }
}

// Local per-file request state. Global dedup only reports the delta a copy adds
// to the store, which is zero for a copied file; the legacy cumulative counter
// in that file still has to subtract everything the file itself observed.
function codexObserveModern(state, key, tokens) {
  if (!isPlainObject(state.modernObserved)) state.modernObserved = {};
  const previous = Array.isArray(state.modernObserved[key])
    ? state.modernObserved[key]
    : [];
  const vector = codexTokenVector(tokens);
  const next = vector.map((value, index) =>
    Math.max(value, toNonNegInt(previous[index])),
  );
  const added = codexZeroTokens();
  for (let index = 0; index < CODEX_TOKEN_FIELDS.length; index += 1) {
    added[CODEX_TOKEN_FIELDS[index]] = toNonNegInt(next[index] - toNonNegInt(previous[index]));
  }
  state.modernObserved[key] = next;
  return added;
}

function codexCumulativeVector(raw) {
  return isPlainObject(raw) ? codexTokenVector(codexNormalized(raw)) : null;
}

function codexKnownCumulative(entry) {
  if (Array.isArray(entry.thread)) return entry.thread;
  if (Array.isArray(entry.turn)) return entry.turn;
  return null;
}

// Cumulative counters are the strong identity. The vector/time fallback is
// only used for older payloads where either side lacks those counters.
function codexCumulativeTwin(entry, cumulative) {
  const known = codexKnownCumulative(entry);
  if (!Array.isArray(known) || !Array.isArray(cumulative)) return true;
  return codexSameTokens(known, cumulative);
}

function codexPendingTwinKey(
  pending,
  tokens,
  timestamp,
  cumulative,
  responseId,
  turnId,
) {
  if (
    !isPlainObject(pending) ||
    typeof pending.key !== "string" ||
    !codexSameTokens(pending.tokens, codexTokenVector(tokens)) ||
    !codexCloseInTime(pending.timestamp, timestamp)
  ) {
    return null;
  }
  if (responseId && pending.responseId && responseId !== pending.responseId) {
    return null;
  }
  if (
    Array.isArray(pending.cumulative) &&
    Array.isArray(cumulative) &&
    !codexSameTokens(pending.cumulative, cumulative)
  ) {
    return null;
  }
  if (turnId && pending.turnId && turnId !== pending.turnId) return null;
  return pending.key;
}

function codexSubtract(tokens, represented) {
  const out = { ...tokens };
  for (const field of CODEX_TOKEN_FIELDS) {
    out[field] = Math.max(0, tokens[field] - toNonNegInt(represented[field]));
  }
  out.nonzero = CODEX_TOKEN_FIELDS.some((field) => out[field] > 0);
  return out;
}

function codexRememberModern(state, key, tokens, timestamp, identity) {
  if (!Array.isArray(state.modernRecent)) state.modernRecent = [];
  state.modernRecent.push({
    key,
    tokens: codexTokenVector(tokens),
    timestamp,
    thread: identity.thread,
    turn: identity.turn,
    responseId: identity.responseId,
    turnId: identity.turnId,
  });
  if (state.modernRecent.length > 8) state.modernRecent.shift();
}

function codexTakeModernTwin(
  state,
  tokens,
  timestamp,
  cumulative,
  responseId,
  turnId,
) {
  if (!Array.isArray(state.modernRecent)) return null;
  const vector = codexTokenVector(tokens);
  for (let index = state.modernRecent.length - 1; index >= 0; index -= 1) {
    const candidate = state.modernRecent[index];
    if (
      isPlainObject(candidate) &&
      typeof candidate.key === "string" &&
      codexSameTokens(candidate.tokens, vector) &&
      codexCloseInTime(candidate.timestamp, timestamp) &&
      codexCumulativeTwin(candidate, cumulative) &&
      (!responseId || !candidate.responseId || responseId === candidate.responseId) &&
      (!turnId || !candidate.turnId || turnId === candidate.turnId)
    ) {
      state.modernRecent.splice(index, 1);
      return candidate.key;
    }
  }
  return null;
}

function parseCodex(record, ctx) {
  if (!isPlainObject(record)) return;
  const state = ctx.state;
  const payload = isPlainObject(record.payload) ? record.payload : {};
  const timestamp =
    parseTimestamp(record.timestamp) ?? state.timestamp ?? null;

  if (record.type === "session_meta") {
    const threadId = asString(
      payload.id ?? payload.session_id ?? payload.thread_id,
      "",
    );
    const firstHeader = !state.session;
    if (threadId && firstHeader) state.session = threadId;
    if (firstHeader || !state.project) {
      state.project = asString(payload.cwd, state.project ?? "unknown");
    }
    if (firstHeader || !state.provider) {
      state.provider = asString(
        payload.model_provider,
        state.provider ?? "unknown",
      );
    }
    if (firstHeader || state.timestamp === undefined) {
      state.timestamp = parseTimestamp(payload.timestamp ?? record.timestamp);
    }
    if (!state.model) state.model = "unknown";
    return;
  }

  if (record.type === "turn_context") {
    const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
    const context = {
      model: asString(payload.model, state.model ?? "unknown"),
      provider: asString(state.provider),
      project: asString(payload.cwd, state.project ?? "unknown"),
      lastRow: null,
    };
    if (!isPlainObject(state.turns)) state.turns = {};
    if (turnId) {
      const previous = state.turns[turnId];
      if (previous?.lastRow) context.lastRow = previous.lastRow;
      state.turns[turnId] = context;
    }
    state.model = context.model;
    state.project = context.project;
    return;
  }

  if (record.type === "token_usage_record") {
    state.modern = true;
    if (timestamp === null) {
      ctx.warn("Codex token usage record has no usable timestamp; skipped");
      return;
    }
    const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
    const context = codexContext(state, turnId);
    const session = codexRecordSession(state, ctx, payload);
    const usage = isPlainObject(payload.usage) ? payload.usage : null;
    if (!usage) return;
    const tokens = codexNormalized(usage);
    if (!tokens.nonzero) return;
    const responseId = asString(payload.response_id, "");
    const thread = codexCumulativeVector(payload.thread_token_usage);
    const turn = codexCumulativeVector(payload.turn_token_usage);
    const cumulative = thread ?? turn;
    const identity = responseId
      ? ["response", responseId]
      : [
          "turn",
          session,
          turnId,
          record.timestamp ?? ctx.lineHash,
          tokens.input,
          tokens.output,
          tokens.cacheRead,
          tokens.cacheWrite,
          tokens.reasoning,
        ];
    let dedupKey = makeDedupKey("codex", ...identity);
    let mergedTwin = false;
    const twinKey = codexPendingTwinKey(
      state.pendingTwin,
      tokens,
      timestamp,
      cumulative,
      responseId,
      turnId,
    );
    if (
      responseId &&
      isPlainObject(state.responseKeys) &&
      typeof state.responseKeys[responseId] === "string"
    ) {
      dedupKey = state.responseKeys[responseId];
      mergedTwin = true;
    } else if (twinKey) {
      // A token_count twin can precede its token_usage_record. Reuse the
      // token_count contribution instead of counting the turn twice.
      dedupKey = twinKey;
      mergedTwin = true;
      if (responseId) {
        if (!isPlainObject(state.responseKeys)) state.responseKeys = {};
        state.responseKeys[responseId] = dedupKey;
      }
    }
    const result = ctx.addUsage(
      metaFor(
        "codex",
        session,
        timestamp,
        context.project,
        context.provider,
        context.model,
      ),
      tokens,
      dedupKey,
    );
    const observed = codexObserveModern(state, dedupKey, tokens);
    if (!twinKey) codexAddPending(state, observed);
    state.pendingTwin = null;
    codexRememberModern(state, dedupKey, tokens, timestamp, {
      thread,
      turn,
      responseId,
      turnId,
    });
    if (turnId) {
      if (!isPlainObject(state.turns)) state.turns = {};
      const entry = state.turns[turnId] ?? context;
      entry.lastRow = { fileId: result.fileId, rowIdx: result.rowIdx };
      state.turns[turnId] = entry;
    }
    state.lastRow = { fileId: result.fileId, rowIdx: result.rowIdx };
    if (mergedTwin) state.modern = true;
    return;
  }

  if (
    record.type === "event_msg" &&
    payload.type === "token_count"
  ) {
    if (timestamp === null) return;
    state.pendingTwin = null;
    const info = isPlainObject(payload.info) ? payload.info : {};
    const totals = isPlainObject(info.total_token_usage)
      ? info.total_token_usage
      : null;
    const session = codexRecordSession(state, ctx, payload);
    const context = codexContext(state, asString(payload.turn_id, ""));
    let raw;
    let identityTail;
    let reset = false;

    if (totals) {
      const current = {
        input_tokens: toNonNegInt(totals.input_tokens),
        cached_input_tokens: toNonNegInt(totals.cached_input_tokens),
        cache_write_input_tokens: toNonNegInt(totals.cache_write_input_tokens),
        output_tokens: toNonNegInt(totals.output_tokens),
        reasoning_output_tokens: toNonNegInt(totals.reasoning_output_tokens),
      };
      const previous = isPlainObject(state.legacyTotals)
        ? state.legacyTotals
        : null;
      // A reset belongs to the whole counter vector, not just the fields that
      // decreased. Other fields may already exceed their old values on restart.
      reset = Boolean(previous && Object.keys(current).some((key) => current[key] < toNonNegInt(previous[key])));
      raw = {};
      for (const key of Object.keys(current)) {
        raw[key] = !previous || reset ? current[key] : current[key] - toNonNegInt(previous[key]);
      }
      state.legacyTotals = current;
      identityTail = [
        "legacy",
        record.timestamp ?? ctx.lineHash,
        current.input_tokens,
        current.cached_input_tokens,
        current.cache_write_input_tokens,
        current.output_tokens,
        current.reasoning_output_tokens,
      ];
    } else if (isPlainObject(info.last_token_usage)) {
      raw = info.last_token_usage;
      identityTail = [
        "legacy-last",
        record.timestamp ?? ctx.lineHash,
        raw.input_tokens,
        raw.cached_input_tokens,
        raw.cache_write_input_tokens,
        raw.output_tokens,
        raw.reasoning_output_tokens,
      ];
    } else {
      return;
    }

    let tokens = codexNormalized(raw);
    let cumulative = null;
    if (totals) {
      cumulative = codexCumulativeVector(totals);
      const pending = codexPendingTokens(state);
      if (!reset) tokens = codexSubtract(tokens, pending);
      state.modernPending = codexZeroTokens();
    }
    if (!tokens.nonzero) return;

    let dedupKey = makeDedupKey("codex", session, ...identityTail);
    let usedModernTwin = false;
    if (!reset) {
      const modernKey = codexTakeModernTwin(
        state,
        tokens,
        timestamp,
        cumulative,
        asString(payload.response_id, ""),
        asString(payload.turn_id ?? payload.root_turn_id, ""),
      );
      if (modernKey) {
        dedupKey = modernKey;
        usedModernTwin = true;
      }
    }
    const result = ctx.addUsage(
      metaFor(
        "codex",
        session,
        timestamp,
        context.project,
        context.provider,
        context.model,
      ),
      tokens,
      dedupKey,
    );
    state.lastRow = { fileId: result.fileId, rowIdx: result.rowIdx };
    if (!usedModernTwin) {
      // Keep this contribution available if the matching token_usage_record
      // appears immediately after the token_count record.
      state.pendingTwin = {
        key: dedupKey,
        tokens: codexTokenVector(tokens),
        timestamp,
        cumulative,
        responseId: asString(payload.response_id, ""),
        turnId: asString(payload.turn_id ?? payload.root_turn_id, ""),
      };
    } else {
      state.pendingTwin = null;
    }
    if (payload.turn_id) {
      if (!isPlainObject(state.turns)) state.turns = {};
      const entry = state.turns[payload.turn_id] ?? context;
      entry.lastRow = state.lastRow;
      state.turns[payload.turn_id] = entry;
    }
    return;
  }

  if (record.type === "event_msg" && payload.type === "task_complete") {
    const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
    const context = codexContext(state, turnId);
    let duration = Number.isFinite(payload.duration_ms)
      ? toNonNegInt(payload.duration_ms)
      : 0;
    if (!duration) {
      const started = Number(payload.started_at);
      const completed = Number(payload.completed_at);
      if (Number.isFinite(started) && Number.isFinite(completed) && completed >= started) {
        duration = toNonNegInt((completed - started) * 1000);
      }
    }
    if (duration <= 0) return;
    const target = context.lastRow ?? state.lastRow;
    if (!target) return;
    const session = codexRecordSession(state, ctx, payload);
    ctx.addTask(
      target.fileId,
      target.rowIdx,
      taskKeyFor(
        "codex",
        "task",
        session,
        turnId || record.timestamp || payload.completed_at || duration,
      ),
      duration,
      session,
      true,
    );
  }
}

// ---------------------------------------------------------------------------
// Antigravity compact transcript fallback; counts are per model step.
function parseAntigravity(record, ctx) {
  if (!isPlainObject(record) || record.source !== "MODEL") return;
  if (!Number.isSafeInteger(record.step_index) || record.step_index < 0) return;
  const conversation = antigravityConversation(ctx.file.path);
  const timestamp = parseTimestamp(record.created_at);
  if (timestamp === null) {
    ctx.warn("Antigravity model step has no usable timestamp; skipped");
    return;
  }
  const tokens = normalizeTokens({
    input: record.input_tokens,
    output: record.output_tokens,
    cacheRead: record.cache_read_tokens,
  });
  if (!tokens.nonzero) return;
  const session = `antigravity:${conversation}`;
  ctx.addUsage(
    metaFor("antigravity", session, timestamp, record.workspace, record.provider, record.model),
    tokens,
    makeDedupKey("antigravity", conversation, record.step_index),
  );
}

// ---------------------------------------------------------------------------
// Declarative custom JSONL

export function getPath(object, path) {
  if (typeof path !== "string" || !path) return undefined;
  const parts = path.split(".");
  let current = object;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined;
      current = current[Number(part)];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, part)) return undefined;
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function resolveField(spec, record, fallback) {
  if (!spec) return fallback;
  if (Object.hasOwn(spec, "literal")) return spec.literal;
  const value = getPath(record, spec.path);
  if (value === undefined || value === null) {
    return Object.hasOwn(spec, "default") ? spec.default : fallback;
  }
  return value;
}

function customIncludes(mapping, record) {
  if (!Array.isArray(mapping.include)) return true;
  for (const condition of mapping.include) {
    const value = getPath(record, condition.path);
    if (Object.hasOwn(condition, "exists")) {
      if (condition.exists && value === undefined) return false;
      if (!condition.exists && value !== undefined) return false;
    } else if (value !== condition.equals) {
      return false;
    }
  }
  return true;
}

function customString(value, fallback = "unknown") {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function parseCustom(record, ctx) {
  if (!isPlainObject(record)) return;
  const mapping = ctx.source.mapping;
  if (!customIncludes(mapping, record)) return;

  if (mapping.roles) {
    const role = customString(resolveField(mapping.role, record), "");
    if (!mapping.roles.includes(role)) return;
  }

  const rawSession = customString(resolveField(mapping.session, record), "");
  const session = rawSession
    ? `custom:${ctx.source.id}:${rawSession}`
    : `custom:${ctx.source.id}:file:${ctx.file.path}`;
  const timestamp = parseTimestamp(resolveField(mapping.timestamp, record));
  if (timestamp === null) {
    ctx.warn(`custom source ${ctx.source.id}: record has no usable timestamp; skipped`);
    return;
  }
  const project = customString(resolveField(mapping.project, record));
  const provider = customString(resolveField(mapping.provider, record));
  const model = customString(resolveField(mapping.model, record));
  const harness = mapping.harness ?? ctx.source.id;

  const rawUsage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning"]) {
    const spec = mapping.usage[key];
    if (spec) rawUsage[key] = resolveField(spec, record, 0);
  }
  const tokens = normalizeTokens(rawUsage);
  if (!tokens.nonzero) return;

  const messageValue = resolveField(mapping.messageId, record);
  const messageId = customString(messageValue, "");
  const identity = messageId
    ? ["message", messageId]
    : ["line", session, timestamp, ctx.lineHash];
  const dedupKey = makeDedupKey(harness, ...identity);
  const result = ctx.addUsage(
    metaFor(harness, session, timestamp, project, provider, model),
    tokens,
    dedupKey,
  );

  if (mapping.taskDurationMs) {
    const durationValue = resolveField(mapping.taskDurationMs, record);
    if (typeof durationValue === "number" && Number.isFinite(durationValue)) {
      const duration = toNonNegInt(durationValue);
      if (duration > 0) {
        ctx.addTask(
          result.fileId,
          result.rowIdx,
          makeTaskKey(harness, "custom-task", dedupKey),
          duration,
          session,
          true,
        );
      }
    }
  }
}

export const ADAPTER_PARSERS = {
  pi: parsePi,
  claude: parseClaude,
  codex: parseCodex,
  antigravity: parseAntigravity,
  custom: parseCustom,
};

export function parseAdapterRecord(adapter, record, ctx) {
  const parser = ADAPTER_PARSERS[adapter];
  if (!parser) throw new Error(`unknown adapter ${adapter}`);
  parser(record, ctx);
}

// Keep lint honest about the public helpers that tests may import.
export { metaFor, piMainSession, claudeSession, codexSession, resolveField };
export { hashKey };
