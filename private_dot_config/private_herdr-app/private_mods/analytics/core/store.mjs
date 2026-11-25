import { readFile } from "node:fs/promises";
import { storeRevisionFingerprint, writePresentationCache } from "./cache.mjs";
import { defaultConfig, migrateLoadedConfig, normalizeConfig } from "./config.mjs";
import {
  STORE_VERSION,
  atomicWriteJson,
  backupCorruptStore,
  ensureParent,
  hashKey,
  isPlainObject,
  sessionHash,
  toNonNegInt,
  tokenTotal,
} from "./util.mjs";

export function fileKey(sourceId, filePath) {
  return `${sourceId}\u0000${filePath}`;
}

const SCAN_STATUSES = new Set([
  "idle",
  "running",
  "partial",
  "complete",
  "failed",
  "reconfiguring",
]);

function zeroScanStats() {
  return { files: 0, filesRead: 0, bytesRead: 0, unchangedFiles: 0, errors: 0 };
}

export function emptyScanState() {
  return {
    status: "idle",
    generation: 0,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    processed: 0,
    total: 0,
    stats: zeroScanStats(),
    sourceStats: {},
    warnings: [],
    currentFile: null,
    pendingFile: null,
    workerPid: null,
    error: null,
  };
}

/** Additive, backward-compatible store metadata for truthful scan state. */
export function ensureStoreMeta(store) {
  if (!Number.isInteger(store.generation) || store.generation < 0) store.generation = 0;
  if (store.lastCompletedScanAt === undefined) store.lastCompletedScanAt = null;
  if (!isPlainObject(store.scan)) store.scan = emptyScanState();
  const scan = store.scan;
  if (!SCAN_STATUSES.has(scan.status)) scan.status = "idle";
  if (!Number.isInteger(scan.generation) || scan.generation < 0) scan.generation = 0;
  for (const field of ["startedAt", "updatedAt", "completedAt", "currentFile", "error"]) {
    if (scan[field] === undefined) scan[field] = null;
  }
  if (!isPlainObject(scan.stats)) scan.stats = zeroScanStats();
  if (!isPlainObject(scan.sourceStats)) scan.sourceStats = {};
  if (!Array.isArray(scan.warnings)) scan.warnings = [];
  if (!Number.isInteger(scan.processed) || scan.processed < 0) scan.processed = 0;
  if (!Number.isInteger(scan.total) || scan.total < 0) scan.total = 0;
  if (scan.pendingFile !== null && !isPlainObject(scan.pendingFile)) scan.pendingFile = null;
  if (!Number.isInteger(scan.workerPid) || scan.workerPid <= 0) scan.workerPid = null;
  return store;
}

export function storeGeneration(store) {
  const value = Number(store?.generation);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function emptyStore(config = defaultConfig()) {
  const store = {
    version: STORE_VERSION,
    config,
    generation: 0,
    nextFileId: 1,
    files: {},
    dedup: {},
    tasks: {},
    lastScanAt: null,
    lastCompletedScanAt: null,
    scan: emptyScanState(),
  };
  prepareStore(store);
  return store;
}

export function prepareStore(store) {
  const byId = new Map();
  for (const entry of Object.values(store.files ?? {})) {
    if (entry && Number.isInteger(entry.id)) {
      byId.set(entry.id, entry);
      attachStore(entry, store);
    }
  }
  Object.defineProperty(store, "_byId", {
    value: byId,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return store;
}

function attachStore(entry, store) {
  if (entry._store === store) return;
  Object.defineProperty(entry, "_store", {
    value: store, enumerable: false, writable: true, configurable: true,
  });
}

export function findFileById(store, id) {
  if (!store._byId) prepareStore(store);
  return store._byId.get(id) ?? null;
}

export function addFileEntry(store, entry) {
  if (!store._byId) prepareStore(store);
  const key = fileKey(entry.sourceId, entry.path);
  const tx = store._tx;
  if (tx) {
    const existing = store.files[key];
    if (existing && existing !== entry) tx.trackFile(existing);
    if (!existing) tx.createdFileKeys.add(key);
    if (!existing || existing.id !== entry.id) tx.createdFileIds.add(entry.id);
  }
  store.files[key] = entry;
  store._byId.set(entry.id, entry);
  attachStore(entry, store);
  return entry;
}

const TX_MISSING = Symbol("analytics-tx-missing");

function cloneAux(value, index) {
  const aux = value[index];
  if (!isPlainObject(aux)) return value;
  const copy = { ...aux };
  if (Array.isArray(aux.copies)) copy.copies = [...aux.copies];
  if (isPlainObject(aux.meta)) copy.meta = { ...aux.meta };
  value[index] = copy;
  return value;
}

function cloneRecord(value, auxIndex) {
  if (!Array.isArray(value)) return value;
  return cloneAux([...value], auxIndex);
}

function snapshotFileEntry(entry) {
  const fields = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "rows" || key === "tasks" || key === "state" || key === "_rowIndex") continue;
    fields[key] = value;
  }
  return {
    entry,
    fields,
    rowsRef: Array.isArray(entry.rows) ? entry.rows : null,
    rowsLength: Array.isArray(entry.rows) ? entry.rows.length : 0,
    rows: new Map(),
    tasksRef: Array.isArray(entry.tasks) ? entry.tasks : null,
    tasks: Array.isArray(entry.tasks) ? [...entry.tasks] : [],
    state: structuredClone(entry.state ?? {}),
  };
}

/**
 * Precise per-file transaction. Existing mutation helpers keep their single
 * accounting implementation; they only announce which dedup/task/row records
 * they are about to touch. Unchanged history is never cloned, so cost follows
 * the records a file actually changes rather than the whole accumulated store.
 */
export function beginStoreTransaction(store, { fileId } = {}) {
  if (store._tx) throw new Error("a store transaction is already active");
  const tx = {
    store,
    savedFiles: new Map(),
    savedDedup: new Map(),
    savedTasks: new Map(),
    createdFileKeys: new Set(),
    createdFileIds: new Set(),
    deletedFiles: new Map(),
    nextFileId: store.nextFileId,
    active: true,
    trackFile(entry) {
      if (!entry || !Number.isInteger(entry.id)) return null;
      if (tx.createdFileIds.has(entry.id)) return null;
      if (!tx.savedFiles.has(entry.id)) tx.savedFiles.set(entry.id, snapshotFileEntry(entry));
      return tx.savedFiles.get(entry.id);
    },
    trackFileById(id) {
      const entry = findFileById(store, id);
      return tx.trackFile(entry);
    },
    trackRow(entry, index) {
      if (!entry || !Number.isInteger(index) || index < 0) return;
      const record = tx.trackFile(entry);
      if (!record) return;
      // When a reset replaced the rows array, rollback restores the original
      // array wholesale; per-index snapshots of the new array would overwrite it.
      if (record.rowsRef && entry.rows !== record.rowsRef) return;
      // Rows created during the transaction are removed by truncating to the
      // original length; do not re-add them from a later snapshot.
      if (index >= record.rowsLength) return;
      if (!record.rows.has(index)) {
        const row = entry.rows?.[index];
        record.rows.set(index, isPlainObject(row) ? { ...row } : row);
      }
    },
    touchDedup(key) {
      if (tx.savedDedup.has(key)) return;
      const value = Object.hasOwn(store.dedup, key) ? store.dedup[key] : TX_MISSING;
      tx.savedDedup.set(key, value === TX_MISSING ? TX_MISSING : cloneRecord(value, DEDUP_AUX_INDEX));
    },
    touchTask(key) {
      if (tx.savedTasks.has(key)) return;
      const value = Object.hasOwn(store.tasks, key) ? store.tasks[key] : TX_MISSING;
      tx.savedTasks.set(key, value === TX_MISSING ? TX_MISSING : cloneRecord(value, TASK_AUX_INDEX));
    },
    deleteFileEntry(key, entry) {
      tx.trackFile(entry);
      tx.deletedFiles.set(key, entry);
      tx.createdFileKeys.delete(key);
    },
  };
  Object.defineProperty(store, "_tx", {
    value: tx, enumerable: false, writable: true, configurable: true,
  });
  if (Number.isInteger(fileId)) tx.trackFileById(fileId);
  return tx;
}

export function commitStoreTransaction(tx) {
  if (!tx?.active) return false;
  tx.active = false;
  if (tx.store._tx === tx) delete tx.store._tx;
  return true;
}

export function rollbackStoreTransaction(tx) {
  if (!tx?.active) return false;
  tx.active = false;
  const store = tx.store;
  for (const saved of tx.savedFiles.values()) {
    const entry = saved.entry;
    for (const key of Object.keys(entry)) {
      if (key === "rows" || key === "tasks" || key === "state" || key === "_rowIndex") continue;
      if (!Object.hasOwn(saved.fields, key)) delete entry[key];
    }
    Object.assign(entry, saved.fields);
    if (saved.rowsRef) {
      saved.rowsRef.length = saved.rowsLength;
      for (const [index, row] of saved.rows) saved.rowsRef[index] = row;
      entry.rows = saved.rowsRef;
    } else {
      entry.rows = [];
    }
    if (saved.tasksRef) {
      saved.tasksRef.length = 0;
      saved.tasksRef.push(...saved.tasks);
      entry.tasks = saved.tasksRef;
    } else {
      entry.tasks = [];
    }
    entry.state = saved.state;
    // A row mutation can invalidate the transient row index. Rebuilding it
    // lazily after rollback is cheap relative to a rare corrupt archive.
    delete entry._rowIndex;
  }
  for (const [key, value] of tx.savedDedup) {
    if (value === TX_MISSING) delete store.dedup[key];
    else store.dedup[key] = value;
  }
  for (const [key, value] of tx.savedTasks) {
    if (value === TX_MISSING) delete store.tasks[key];
    else store.tasks[key] = value;
  }
  for (const key of tx.createdFileKeys) {
    const entry = store.files[key];
    if (entry && tx.createdFileIds.has(entry.id)) {
      delete store.files[key];
      store._byId?.delete(entry.id);
    }
  }
  for (const [key, entry] of tx.deletedFiles) {
    store.files[key] = entry;
    store._byId?.set(entry.id, entry);
  }
  store.nextFileId = tx.nextFileId;
  if (store._tx === tx) delete store._tx;
  // Rebuild the transient id index from the restored file map. Rollback is a
  // rare recovery path, so an O(files) rebuild is preferable to a stale index.
  prepareStore(store);
  return true;
}

export function newFileEntry(store, values) {
  const entry = {
    id: store.nextFileId++,
    ...values,
    offset: 0,
    lineNo: 0,
    rows: [],
    tasks: [],
    state: {},
  };
  addFileEntry(store, entry);
  return entry;
}

export function deleteFileEntry(store, key) {
  const entry = store.files[key];
  if (!entry) return null;
  store._tx?.deleteFileEntry(key, entry);
  removeOwnedMetadata(store, entry.id);
  delete store.files[key];
  if (store._byId) store._byId.delete(entry.id);
  return entry;
}

export function removeOwnedMetadata(store, fileId) {
  const tx = store._tx;
  for (const [key, value] of Object.entries(store.dedup)) {
    if (!Array.isArray(value)) continue;
    const aux = value[DEDUP_AUX_INDEX];
    const hasCopy = isPlainObject(aux) && Array.isArray(aux.copies) && aux.copies.includes(fileId);
    if (hasCopy) tx?.touchDedup(key);
    if (hasCopy) dropCopyCandidate(value, DEDUP_AUX_INDEX, fileId);
    if (value[0] !== fileId) continue;
    tx?.touchDedup(key);
    if (transferDedupOwnership(store, value)) continue;
    delete store.dedup[key];
  }
  for (const [key, value] of Object.entries(store.tasks)) {
    if (!Array.isArray(value)) continue;
    const aux = value[TASK_AUX_INDEX];
    const hasCopy = isPlainObject(aux) && Array.isArray(aux.copies) && aux.copies.includes(fileId);
    if (hasCopy) tx?.touchTask(key);
    if (hasCopy) dropCopyCandidate(value, TASK_AUX_INDEX, fileId);
    if (value[0] !== fileId) continue;
    tx?.touchTask(key);
    if (transferTaskOwnership(store, value)) continue;
    delete store.tasks[key];
  }
}

export function resetFileEntry(store, entry) {
  store._tx?.trackFile(entry);
  removeOwnedMetadata(store, entry.id);
  entry.offset = 0;
  entry.lineNo = 0;
  entry.rows = [];
  delete entry._rowIndex;
  entry.tasks = [];
  entry.state = {};
  return entry;
}

export function clearCollectedData(store) {
  if (store._tx) throw new Error("cannot clear collected data inside a transaction");
  store.files = {};
  store.dedup = {};
  store.tasks = {};
  store.nextFileId = 1;
  prepareStore(store);
}

export function getOrCreateRow(file, meta) {
  storeTrackFileForRow(file);
  // OpenCode puts the entire history in one file. A linear search here makes
  // a cold scan quadratic in the number of session/model buckets.
  if (!file._rowIndex || file._rowIndex.length !== file.rows.length) {
    const map = new Map();
    file.rows.forEach((row, index) => {
      const key = rowKey(row);
      if (!map.has(key)) map.set(key, index);
    });
    Object.defineProperty(file, "_rowIndex", {
      value: { map, length: file.rows.length }, configurable: true,
    });
  }
  const key = rowKey(meta);
  const existing = file._rowIndex.map.get(key);
  if (existing !== undefined) return existing;
  file.rows.push({
    day: meta.day,
    session: meta.session,
    harness: meta.harness,
    provider: meta.provider,
    model: meta.model,
    project: meta.project,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    messages: 0,
  });
  const index = file.rows.length - 1;
  file._rowIndex.map.set(key, index);
  file._rowIndex.length = file.rows.length;
  return index;
}

function storeTrackFileForRow(file) {
  const store = file?._store;
  if (!store?._tx) return;
  store._tx.trackFile(file);
}

function addRowTokens(row, tokens) {
  row.input = toNonNegInt(row.input + tokens.input);
  row.output = toNonNegInt(row.output + tokens.output);
  row.cacheRead = toNonNegInt(row.cacheRead + tokens.cacheRead);
  row.cacheWrite = toNonNegInt(row.cacheWrite + tokens.cacheWrite);
  row.reasoning = toNonNegInt(row.reasoning + tokens.reasoning);
}

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const DEDUP_AUX_INDEX = 7;
const TASK_AUX_INDEX = 5;

function rowMeta(row) {
  return {
    day: row.day,
    session: row.session,
    harness: row.harness,
    provider: row.provider,
    model: row.model,
    project: row.project,
  };
}

function validAuxMeta(meta) {
  return (
    isPlainObject(meta) &&
    ["day", "session", "harness", "provider", "model", "project"].every(
      (field) => typeof meta[field] === "string",
    )
  );
}

function auxFor(entry, index, row) {
  let aux = entry[index];
  if (!isPlainObject(aux)) aux = {};
  if (!Array.isArray(aux.copies)) aux.copies = [];
  if (!validAuxMeta(aux.meta)) aux.meta = rowMeta(row);
  entry[index] = aux;
  return aux;
}

function recordCopyCandidate(entry, index, row, fileId) {
  const aux = auxFor(entry, index, row);
  if (!aux.copies.includes(fileId)) aux.copies.push(fileId);
}

function refreshConcreteProvider(owner, row, entry, meta) {
  if (
    row.provider !== "unknown" ||
    typeof meta.provider !== "string" ||
    meta.provider.length === 0 ||
    meta.provider === "unknown"
  ) {
    return false;
  }
  row.provider = meta.provider;
  // The row's bucket key changed. Rebuild the transient index lazily rather
  // than trying to merge another row that may already occupy the new bucket.
  delete owner._rowIndex;
  const aux = entry[DEDUP_AUX_INDEX];
  if (isPlainObject(aux) && validAuxMeta(aux.meta)) aux.meta.provider = meta.provider;
  return true;
}

function dropCopyCandidate(entry, index, fileId) {
  const aux = entry[index];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies)) return;
  aux.copies = aux.copies.filter((id) => id !== fileId);
}

function takeCandidate(store, aux) {
  while (aux.copies.length > 0) {
    const candidateId = aux.copies.shift();
    const candidate = findFileById(store, candidateId);
    if (candidate) return candidate;
  }
  return null;
}

function transferDedupOwnership(store, entry) {
  const aux = entry[DEDUP_AUX_INDEX];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies) || !validAuxMeta(aux.meta)) {
    return false;
  }
  const candidate = takeCandidate(store, aux);
  if (!candidate) return false;
  store._tx?.trackFile(candidate);
  const rowIdx = getOrCreateRow(candidate, aux.meta);
  store._tx?.trackRow(candidate, rowIdx);
  const row = candidate.rows[rowIdx];
  addRowTokens(row, {
    input: entry[2],
    output: entry[3],
    cacheRead: entry[4],
    cacheWrite: entry[5],
    reasoning: entry[6],
  });
  row.messages = toNonNegInt(row.messages + 1);
  entry[0] = candidate.id;
  entry[1] = rowIdx;
  return true;
}

function transferTaskOwnership(store, entry) {
  const aux = entry[TASK_AUX_INDEX];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies) || !validAuxMeta(aux.meta)) {
    return false;
  }
  const candidate = takeCandidate(store, aux);
  if (!candidate) return false;
  store._tx?.trackFile(candidate);
  const rowIdx = getOrCreateRow(candidate, aux.meta);
  entry[0] = candidate.id;
  entry[1] = rowIdx;
  return true;
}

// Usage dedup is a max-upsert: Claude streams the same message.id repeatedly
// and revises its numbers upward. One message, maximum numeric value per field.
export function addUsage(store, file, meta, tokens, dedupKey) {
  const tx = store._tx;
  const entry = store.dedup[dedupKey];
  if (Array.isArray(entry)) {
    const owner = findFileById(store, entry[0]);
    const row = owner?.rows?.[entry[1]];
    if (owner && row) {
      tx?.trackFile(owner);
      tx?.trackRow(owner, entry[1]);
      tx?.touchDedup(dedupKey);
      let changed = refreshConcreteProvider(owner, row, entry, meta);
      const added = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      };
      for (let index = 0; index < TOKEN_FIELDS.length; index += 1) {
        const field = TOKEN_FIELDS[index];
        const previous = toNonNegInt(entry[index + 2]);
        if (tokens[field] > previous) {
          added[field] = tokens[field] - previous;
          row[field] = toNonNegInt(row[field] + added[field]);
          entry[index + 2] = tokens[field];
          changed = true;
        }
      }
      if (owner.id !== file.id) {
        recordCopyCandidate(entry, DEDUP_AUX_INDEX, row, file.id);
      }
      return {
        fileId: owner.id,
        rowIdx: entry[1],
        row,
        isNew: false,
        changed,
        added,
      };
    }
    // Save the stale entry before removing it so a rollback restores the
    // exact committed dedup map, including an owner that no longer exists.
    tx?.touchDedup(dedupKey);
    delete store.dedup[dedupKey];
  }

  tx?.trackFile(file);
  tx?.touchDedup(dedupKey);
  const rowIdx = getOrCreateRow(file, meta);
  tx?.trackRow(file, rowIdx);
  const row = file.rows[rowIdx];
  addRowTokens(row, tokens);
  row.messages = toNonNegInt(row.messages + 1);
  store.dedup[dedupKey] = [
    file.id,
    rowIdx,
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.reasoning,
  ];
  return {
    fileId: file.id,
    rowIdx,
    row,
    isNew: true,
    changed: true,
    added: {
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      reasoning: tokens.reasoning,
    },
  };
}

export function addTask(
  store,
  fileId,
  rowIdx,
  taskKey,
  durationMs,
  session,
  exact,
  candidateFileId = fileId,
) {
  const ms = toNonNegInt(durationMs);
  const tx = store._tx;
  const owner = findFileById(store, fileId);
  const row = owner?.rows?.[rowIdx];
  if (!owner || !row) return false;
  tx?.trackFile(owner);
  const existing = store.tasks[taskKey];
  if (Array.isArray(existing)) {
    tx?.touchTask(taskKey);
    if (existing[0] !== candidateFileId) {
      const existingOwner = findFileById(store, existing[0]);
      const existingRow = existingOwner?.rows?.[existing[1]];
      if (existingOwner && existingRow) {
        recordCopyCandidate(existing, TASK_AUX_INDEX, existingRow, candidateFileId);
      }
    }
    if (existing[0] === fileId && exact && existing[3] === 0) {
      existing[2] = ms;
      existing[3] = 1;
      return true;
    }
    if (existing[0] === fileId && !exact && existing[3] === 0 && ms > existing[2]) {
      existing[2] = ms;
      return true;
    }
    return false;
  }
  const sHash = sessionHash(session);
  tx?.touchTask(taskKey);
  store.tasks[taskKey] = [fileId, rowIdx, ms, exact ? 1 : 0, sHash];
  if (!Array.isArray(owner.tasks)) owner.tasks = [];
  owner.tasks.push(taskKey);
  return true;
}

export function removeLatestFallbackTaskForSession(store, session) {
  const sHash = sessionHash(session);
  const keys = Object.keys(store.tasks);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    const entry = store.tasks[key];
    if (Array.isArray(entry) && entry[3] === 0 && entry[4] === sHash) {
      store._tx?.touchTask(key);
      delete store.tasks[key];
      const owner = findFileById(store, entry[0]);
      store._tx?.trackFile(owner);
      if (Array.isArray(owner?.tasks)) {
        owner.tasks = owner.tasks.filter((taskKey) => taskKey !== key);
      }
      return {
        key,
        fileId: entry[0],
        rowIdx: entry[1],
        milliseconds: entry[2],
      };
    }
  }
  return null;
}

function emptyAggregate(meta) {
  return {
    day: meta.day,
    session: meta.session,
    harness: meta.harness,
    provider: meta.provider,
    model: meta.model,
    project: meta.project,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    },
    messages: 0,
    activeMs: 0,
    longestTaskMs: 0,
  };
}

export function snapshotRows(store) {
  const rows = new Map();
  for (const file of Object.values(store.files)) {
    for (const row of file.rows ?? []) {
      const key = rowKey(row);
      let aggregate = rows.get(key);
      if (!aggregate) {
        aggregate = emptyAggregate(row);
        rows.set(key, aggregate);
      }
      aggregate.tokens.input += toNonNegInt(row.input);
      aggregate.tokens.output += toNonNegInt(row.output);
      aggregate.tokens.cacheRead += toNonNegInt(row.cacheRead);
      aggregate.tokens.cacheWrite += toNonNegInt(row.cacheWrite);
      aggregate.tokens.reasoning += toNonNegInt(row.reasoning);
      aggregate.messages += toNonNegInt(row.messages);
    }
  }

  for (const entry of Object.values(store.tasks)) {
    if (!Array.isArray(entry)) continue;
    const file = findFileById(store, entry[0]);
    const row = file?.rows?.[entry[1]];
    if (!row) continue;
    const aggregate = rows.get(rowKey(row));
    if (!aggregate) continue;
    const ms = toNonNegInt(entry[2]);
    aggregate.activeMs += ms;
    if (ms > aggregate.longestTaskMs) aggregate.longestTaskMs = ms;
  }

  const out = [...rows.values()];
  for (const row of out) {
    row.tokens.total = tokenTotal(row.tokens);
  }
  out.sort((a, b) => {
    return (
      a.day.localeCompare(b.day) ||
      a.session.localeCompare(b.session) ||
      a.harness.localeCompare(b.harness) ||
      a.provider.localeCompare(b.provider) ||
      a.model.localeCompare(b.model) ||
      a.project.localeCompare(b.project)
    );
  });
  return out;
}

function rowKey(row) {
  return JSON.stringify([
    row.day,
    row.session,
    row.harness,
    row.provider,
    row.model,
    row.project,
  ]);
}

function validRow(row) {
  return (
    isPlainObject(row) &&
    typeof row.day === "string" &&
    typeof row.session === "string" &&
    typeof row.harness === "string" &&
    typeof row.provider === "string" &&
    typeof row.model === "string" &&
    typeof row.project === "string" &&
    Number.isFinite(row.input) &&
    Number.isFinite(row.output) &&
    Number.isFinite(row.cacheRead) &&
    Number.isFinite(row.cacheWrite) &&
    Number.isFinite(row.reasoning) &&
    Number.isFinite(row.messages) &&
    row.input >= 0 &&
    row.output >= 0 &&
    row.cacheRead >= 0 &&
    row.cacheWrite >= 0 &&
    row.reasoning >= 0 &&
    row.messages >= 0
  );
}

function validateLoadedStore(store) {
  if (!isPlainObject(store) || store.version !== STORE_VERSION) {
    throw new Error("unsupported store version");
  }
  const configMigration = migrateLoadedConfig(normalizeConfig(store.config));
  store.config = configMigration.config;
  if (!isPlainObject(store.files) || !isPlainObject(store.dedup) || !isPlainObject(store.tasks)) {
    throw new Error("store collections are malformed");
  }
  if (!Number.isInteger(store.nextFileId) || store.nextFileId < 1) {
    throw new Error("store nextFileId is malformed");
  }
  const ids = new Set();
  let maxId = 0;
  for (const [key, entry] of Object.entries(store.files)) {
    if (!isPlainObject(entry)) throw new Error(`file entry ${key} is malformed`);
    if (!Number.isInteger(entry.id) || entry.id < 1) {
      throw new Error(`file entry ${key} has a bad id`);
    }
    if (ids.has(entry.id)) throw new Error(`duplicate file id ${entry.id}`);
    ids.add(entry.id);
    maxId = Math.max(maxId, entry.id);
    if (
      typeof entry.sourceId !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.adapter !== "string" ||
      !Number.isFinite(entry.size) ||
      entry.size < 0 ||
      !Number.isFinite(entry.mtimeMs) ||
      !Number.isFinite(entry.offset) ||
      entry.offset < 0 ||
      !Number.isFinite(entry.lineNo) ||
      entry.lineNo < 0
    ) {
      throw new Error(`file entry ${key} is malformed`);
    }
    if (!Array.isArray(entry.rows) || !entry.rows.every(validRow)) {
      throw new Error(`file entry ${key} has malformed rows`);
    }
    if (!Array.isArray(entry.tasks) || !entry.tasks.every((task) => typeof task === "string")) {
      throw new Error(`file entry ${key} has malformed tasks`);
    }
    if (!isPlainObject(entry.state)) {
      throw new Error(`file entry ${key} has malformed state`);
    }
  }
  if (store.nextFileId <= maxId) {
    throw new Error("store nextFileId is behind existing files");
  }
  for (const [key, value] of Object.entries(store.dedup)) {
    const validAux =
      Array.isArray(value) &&
      (value.length === 7 ||
        (value.length === 8 &&
          isPlainObject(value[7]) &&
          Array.isArray(value[7].copies) &&
          value[7].copies.every((id) => Number.isInteger(id)) &&
          validAuxMeta(value[7].meta)));
    if (
      !Array.isArray(value) ||
      !validAux ||
      !Number.isInteger(value[0]) ||
      !Number.isInteger(value[1]) ||
      !value.slice(2, 7).every((number) => Number.isFinite(number) && number >= 0)
    ) {
      throw new Error(`dedup entry ${key} is malformed`);
    }
  }
  for (const [key, value] of Object.entries(store.tasks)) {
    const validAux =
      Array.isArray(value) &&
      (value.length === 5 ||
        (value.length === 6 &&
          isPlainObject(value[5]) &&
          Array.isArray(value[5].copies) &&
          value[5].copies.every((id) => Number.isInteger(id)) &&
          validAuxMeta(value[5].meta)));
    if (
      !Array.isArray(value) ||
      !validAux ||
      !Number.isInteger(value[0]) ||
      !Number.isInteger(value[1]) ||
      !Number.isFinite(value[2]) ||
      value[2] < 0 ||
      (value[3] !== 0 && value[3] !== 1) ||
      typeof value[4] !== "string"
    ) {
      throw new Error(`task entry ${key} is malformed`);
    }
  }
  return configMigration.migrated;
}

export async function loadStore(storePath, { readOnly = false } = {}) {
  const warnings = [];
  let errors = 0;
  if (!readOnly) await ensureParent(storePath);
  let text;
  try {
    text = await readFile(storePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { store: emptyStore(), warnings, errors, exists: false, dirty: true };
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
    const migrated = validateLoadedStore(parsed);
    ensureStoreMeta(parsed);
    prepareStore(parsed);
    return { store: parsed, warnings, errors, exists: true, dirty: migrated };
  } catch (error) {
    // Filter changes are reads, not recovery operations. Leave preservation
    // and repair to the next lock-protected snapshot/configure operation.
    if (readOnly) {
      throw new Error("Analytics store is corrupt; refresh to preserve and rebuild it.", { cause: error });
    }
    let backup;
    try {
      backup = await backupCorruptStore(storePath);
    } catch (backupError) {
      throw new Error(
        `analytics store is corrupt and could not be preserved: ${error.message}; ${backupError.message}`,
        { cause: backupError },
      );
    }
    warnings.push(
      `Store was corrupt and has been preserved at ${backup}; a fresh store was started (${error.message}).`,
    );
    errors += 1;
    return {
      store: emptyStore(),
      warnings,
      errors,
      exists: true,
      corruptBackup: backup,
      dirty: true,
    };
  }
}

export async function saveStore(
  storePath,
  store,
  { completed = false, status, now = new Date() } = {},
) {
  const savedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  ensureStoreMeta(store);
  store.lastScanAt = savedAt;
  const scan = store.scan;
  scan.updatedAt = savedAt;
  scan.generation = storeGeneration(store);
  if (status) scan.status = status;
  if (completed) {
    scan.status = "complete";
    scan.completedAt = savedAt;
    scan.currentFile = null;
    scan.pendingFile = null;
    scan.workerPid = null;
    scan.error = null;
    store.lastCompletedScanAt = savedAt;
  }
  await atomicWriteJson(storePath, store);
  // The presentation cache is derived from this exact committed store. Capture
  // the post-rename identity while the caller still holds writer authority so
  // an old cache can never be accepted for a newer atomic store revision. A
  // failure here must not fail the commit; prepare falls back to the store.
  try {
    const fingerprint = await storeRevisionFingerprint(storePath);
    await writePresentationCache(storePath, {
      savedAt, store, rows: snapshotRows(store), fingerprint,
    });
  } catch { /* the cache is an optional read accelerator */ }
  return savedAt;
}

export function dedupKeyFor(harness, ...parts) {
  return hashKey("usage", harness, ...parts);
}

export function taskKeyFor(harness, ...parts) {
  return hashKey("task", harness, ...parts);
}
