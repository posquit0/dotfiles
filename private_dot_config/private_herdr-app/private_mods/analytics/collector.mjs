#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPresentationCache } from "./core/cache.mjs";
import { migrateLoadedConfig, normalizeConfig, sourcesSignature } from "./core/config.mjs";
import {
  bumpFence,
  readEffectiveFence,
  readWorkerClaim,
  relaxFence,
  restoreFence,
  workerClaimActive,
} from "./core/fence.mjs";
import {
  DEFAULT_WORKER_ACK_MS,
  ensureIndexer,
  waitForIndexerAck,
} from "./core/indexer-control.mjs";
import { scanSources } from "./core/scan.mjs";
import { progressWriter, readLiveProgress } from "./core/progress.mjs";
import {
  clearCollectedData,
  emptyScanState,
  ensureStoreMeta,
  loadStore,
  saveStore,
  snapshotRows,
  storeGeneration,
} from "./core/store.mjs";
import {
  isLockBusyError,
  readStoreLockInfo,
  sleep,
  withStoreLock,
} from "./core/util.mjs";

// Leave room for startup, store load, save, and presentation derivation inside
// Herdr's fixed 30s exec budget. A partial slice returns committed data and the
// UI continues automatically.
export const DEFAULT_SCAN_BUDGET_MS = 15_000;
const FOREGROUND_LOCK_WAIT_MS = 2_000;
const CONFIGURE_LOCK_WAIT_MS = 20_000;

function usage() {
  return [
    "Usage:",
    "  collector.mjs snapshot --store <file> [--home <dir>] [--rebuild]",
    "  collector.mjs configure --store <file> [--home <dir>] --config <json> [--rebuild]",
    "  collector.mjs status --store <file>",
  ].join("\n");
}

function parseArgs(argv) {
  const command = argv[0];
  const options = { rebuild: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rebuild") {
      options.rebuild = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(store|home|config)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unknown argument ${arg}`);
    const key = match[1];
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
      if (value === undefined) throw new Error(`--${key} needs a value`);
    }
    options[key] = value;
  }
  return { command, options };
}

function emptyStats() {
  return {
    files: 0,
    filesRead: 0,
    bytesRead: 0,
    unchangedFiles: 0,
    errors: 0,
    decompressedBytes: 0,
  };
}

function scanView(scan = {}) {
  const stats = scan.stats && typeof scan.stats === "object" ? scan.stats : emptyStats();
  return {
    status: typeof scan.status === "string" ? scan.status : "idle",
    generation: Number.isInteger(scan.generation) ? scan.generation : 0,
    startedAt: scan.startedAt ?? null,
    updatedAt: scan.updatedAt ?? null,
    completedAt: scan.completedAt ?? null,
    processed: Number.isInteger(scan.processed) ? scan.processed : 0,
    total: Number.isInteger(scan.total) ? scan.total : 0,
    files: stats.files ?? 0,
    filesRead: stats.filesRead ?? 0,
    bytesRead: stats.bytesRead ?? 0,
    decompressedBytes: stats.decompressedBytes ?? 0,
    errors: stats.errors ?? 0,
    currentFile: scan.currentFile ?? null,
    pendingFile: scan.pendingFile ?? null,
    workerPid: Number.isInteger(scan.workerPid) ? scan.workerPid : null,
    error: scan.error ?? null,
  };
}

function scanResultFromStore(store) {
  ensureStoreMeta(store);
  return {
    stats: store.scan.stats ?? emptyStats(),
    sourceStats: store.scan.sourceStats ?? {},
    warnings: Array.isArray(store.scan.warnings) ? store.scan.warnings : [],
  };
}

function buildSnapshot(store, scan, nowIso, loadWarnings = [], loadErrors = 0) {
  ensureStoreMeta(store);
  const warnings = [...loadWarnings, ...(scan?.warnings ?? [])];
  const stats = {
    ...emptyStats(),
    ...(scan?.stats ?? {}),
    errors: (scan?.stats?.errors ?? 0) + loadErrors,
  };
  return {
    version: 1,
    generatedAt: nowIso,
    lastScanAt: store.lastScanAt ?? null,
    lastCompletedScanAt: store.lastCompletedScanAt ?? null,
    savedAt: store.lastScanAt ?? null,
    config: store.config,
    rows: snapshotRows(store),
    stats,
    sourceStats: scan?.sourceStats ?? undefined,
    scan: scanView(store.scan),
    warnings,
  };
}

function buildSnapshotFromCache(cached, nowIso) {
  const scan = cached.scan ?? {};
  const stats = { ...emptyStats(), ...(scan.stats ?? {}) };
  return {
    version: 1,
    generatedAt: nowIso,
    lastScanAt: cached.lastScanAt ?? null,
    lastCompletedScanAt: cached.lastCompletedScanAt ?? null,
    savedAt: cached.savedAt ?? cached.lastScanAt ?? null,
    config: cached.config ?? {},
    rows: Array.isArray(cached.rows) ? cached.rows : [],
    stats,
    sourceStats: scan.sourceStats ?? undefined,
    scan: scanView(scan),
    warnings: Array.isArray(scan.warnings) ? scan.warnings : [],
  };
}

function busyOverrides(owner) {
  if (!owner) return {};
  const worker = owner?.role === "worker";
  return {
    status: worker ? "running" : "partial",
    workerPid: worker && Number.isInteger(owner.pid) ? owner.pid : null,
  };
}

function liveView(live) {
  return {
    file: live.file,
    phase: live.phase,
    processed: live.processed,
    total: live.total,
    filesRead: live.filesRead,
    bytesRead: live.bytesRead,
    decodedBytes: live.decodedBytes,
    updatedAt: live.updatedAt,
  };
}

/**
 * Overlay metadata-only worker progress on committed rows/stats. The sidecar is
 * not authoritative: it is accepted only while the matching local claim AND the
 * store writer lock are owned by the same live pid at the committed generation.
 * A stale, dead, replaced, or foreign worker is ignored, and only current file,
 * counters, phase, and timestamps cross the boundary. Rows, config, accounting,
 * and timestamps are never taken from progress.
 */
async function overlayLiveProgress(storePath, snapshot) {
  const scan = snapshot?.scan;
  if (!scan || !["running", "partial", "starting"].includes(scan.status)) return snapshot;
  if (!Number.isInteger(scan.generation)) return snapshot;
  const live = await readLiveProgress(storePath);
  if (!live) return snapshot;
  if (live.store !== path.resolve(storePath) || live.generation !== scan.generation) return snapshot;
  const [claim, owner] = await Promise.all([
    readWorkerClaim(storePath),
    readStoreLockInfo(storePath),
  ]);
  if (!claim || claim.host !== os.hostname() || !workerClaimActive(claim)) return snapshot;
  if (claim.pid !== live.pid || claim.generation !== live.generation || claim.token !== live.token) {
    return snapshot;
  }
  if (!owner || owner.role !== "worker" || owner.host !== os.hostname()) return snapshot;
  if (owner.pid !== live.pid || Number(owner.generation) !== live.generation) return snapshot;
  if (Number.isInteger(scan.workerPid) && scan.workerPid !== live.pid) return snapshot;
  return {
    ...snapshot,
    scan: {
      ...scan,
      status: "running",
      workerPid: live.pid,
      live: liveView(live),
    },
  };
}

/**
 * Committed presentation for a reader. Never takes the writer lock, so a long
 * indexer cannot make status/prepare wait for a scan. The cache is used only
 * when it is at least as new as the committed store. Live worker progress is a
 * sanitized metadata overlay; committed rows/stats remain authoritative.
 */
export async function readCommittedSnapshot(storePath, { now = Date.now } = {}) {
  const nowIso = new Date(now()).toISOString();
  const cached = await readPresentationCache(storePath);
  let snapshot;
  if (cached) {
    snapshot = buildSnapshotFromCache(cached, nowIso);
  } else {
    const loaded = await loadStore(storePath, { readOnly: true });
    snapshot = buildSnapshot(
      loaded.store,
      scanResultFromStore(loaded.store),
      nowIso,
      loaded.warnings,
      loaded.errors,
    );
  }
  return overlayLiveProgress(storePath, snapshot);
}

async function busySnapshot(storePath, owner, now) {
  const snapshot = await readCommittedSnapshot(storePath, { now });
  const overrides = busyOverrides(owner);
  snapshot.scan = { ...snapshot.scan, ...overrides };
  return snapshot;
}

async function generationBaseline(storePath) {
  try {
    const cached = await readPresentationCache(storePath);
    if (cached) return cached.generation;
  } catch { /* fall through to a committed read */ }
  try {
    const loaded = await loadStore(storePath, { readOnly: true });
    return storeGeneration(loaded.store);
  } catch {
    return 0;
  }
}

/**
 * Attempt the writer lock without a 20s wait. A live long-lived worker makes a
 * collector return committed data immediately; ordinary foreground slices get
 * a short coalescing wait. Configure/rebuild mode fences and signals a worker.
 */
async function runWithStoreLock(
  storePath,
  callback,
  {
    waitMs = 0,
    meta = {},
    signalWorker = false,
    fenceGeneration = null,
  } = {},
) {
  const started = Date.now();
  let signaled = false;
  for (;;) {
    try {
      const value = await withStoreLock(storePath, callback, { timeoutMs: 0, meta });
      return { acquired: true, value };
    } catch (error) {
      if (!isLockBusyError(error)) throw error;
      const owner = await readStoreLockInfo(storePath);
      if (owner?.role === "worker") {
        if (
          signalWorker
          && !signaled
          && owner.host === os.hostname()
          && Number.isInteger(owner.pid)
          && owner.pid > 0
          && (fenceGeneration === null || Number(owner.generation ?? 0) < fenceGeneration)
        ) {
          // Same host only. A shared store directory must not signal whatever
          // local process happens to reuse the other machine's worker pid.
          try { process.kill(owner.pid, "SIGTERM"); } catch { /* already exiting */ }
          signaled = true;
        }
        if (!signalWorker) return { acquired: false, owner };
      }
      if (Date.now() - started >= waitMs) return { acquired: false, owner };
      await sleep(40);
    }
  }
}

async function removeStalePendingFile(storePath, store, now) {
  const pending = store.scan?.pendingFile;
  if (!pending?.path) return false;
  let info = null;
  try {
    info = await stat(pending.path);
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }
  if (info?.isFile()) return false;
  store.scan.pendingFile = null;
  store.scan.updatedAt = new Date(now()).toISOString();
  return true;
}

function updateScanFromResult(store, result, { nowIso, previousStatus }) {
  const scan = store.scan;
  const cycleStart = (
    !scan.startedAt
    || previousStatus === "complete"
    || previousStatus === "failed"
    || previousStatus === "idle"
  ) ? nowIso : scan.startedAt;
  scan.startedAt = cycleStart;
  scan.updatedAt = nowIso;
  scan.generation = store.generation;
  scan.processed = result.processed;
  scan.total = result.total;
  scan.stats = result.stats;
  scan.sourceStats = result.sourceStats;
  scan.warnings = result.warnings;
  scan.currentFile = null;
  scan.workerPid = null;
  scan.error = null;
  if (result.abortedFile) {
    scan.status = "partial";
    scan.pendingFile = { ...result.abortedFile, requestedAt: nowIso };
  } else {
    scan.pendingFile = null;
    if (result.complete) {
      scan.status = "complete";
      scan.completedAt = nowIso;
    } else {
      scan.status = "partial";
    }
  }
  return scan;
}

async function scanAndPersist(
  storePath,
  home,
  store,
  {
    loaded,
    dirty,
    budgetMs,
    now,
    testStreamDelayMs,
    mode = "collector",
    guard = null,
  },
) {
  const previousStatus = store.scan?.status ?? "idle";
  const previousPending = store.scan?.pendingFile ?? null;
  const startedAt = now();
  const deadline = startedAt + Math.max(0, Number(budgetMs) || 0);
  const progress = progressWriter(storePath);
  // Foreground stream progress carries only the open file and decoded bytes.
  // Keep the last accepted discovery counters so a mid-file update never
  // replaces useful progress with 0/1, and label decoded bytes separately from
  // the committed accepted stats.
  let live = {
    processed: 0,
    total: 0,
    file: null,
    filesRead: 0,
    bytesRead: 0,
    decodedBytes: 0,
    phase: "scan",
  };
  const publish = (state) => progress.update({ ...live, ...state, mode, workerPid: null });
  let result;
  try {
    result = await scanSources(store, {
      home,
      deadline,
      now,
      mode,
      streamDelayMs: testStreamDelayMs,
      shouldStop: () => false,
      onProgress: (state) => {
        live = { ...live, ...state, decodedBytes: 0 };
        publish(live);
      },
      onStreamProgress: (state) => {
        live = {
          ...live,
          file: state.file ?? live.file,
          phase: state.phase ?? "decompress",
          decodedBytes: Number.isInteger(state.bytes) ? state.bytes : live.decodedBytes,
        };
        publish(live);
      },
    });
  } finally {
    progress.clear();
  }

  const finishedIso = new Date(now()).toISOString();
  updateScanFromResult(store, result, { nowIso: finishedIso, previousStatus });
  const pendingChanged = (store.scan.pendingFile?.path ?? null) !== (previousPending?.path ?? null);
  const completed = Boolean(result.complete);
  const statusChanged = store.scan.status !== previousStatus;
  let mustSave = Boolean(
    dirty
    || result.dirty
    || result.stopped
    || statusChanged
    || pendingChanged
    || loaded?.dirty
  );
  if (completed && !mustSave && store.lastCompletedScanAt === null) mustSave = true;

  const guarded = guard ? await guard() : null;
  if (guarded) return { fenced: true, saved: false };
  if (result.abortedFile) {
    // Persist the abandoned file marker under the writer lock; the worker is
    // spawned by the caller only AFTER this lock is released so it can take
    // ownership immediately instead of exiting on a busy lock.
    await saveStore(storePath, store, { status: "partial", now: finishedIso });
    const snapshot = buildSnapshot(store, result, finishedIso, loaded?.warnings, loaded?.errors);
    return { snapshot, worker: null, promote: true, saved: true };
  }

  if (mustSave) {
    if (completed) store.lastCompletedScanAt = finishedIso;
    await saveStore(storePath, store, {
      completed,
      status: completed ? "complete" : "partial",
      now: finishedIso,
    });
  } else if (completed) {
    // No-op refresh: verification succeeded without changing committed data,
    // so keep the committed timestamps and do not rewrite the store.
    store.lastCompletedScanAt = loaded?.store?.lastCompletedScanAt ?? store.lastCompletedScanAt;
  }
  const snapshot = buildSnapshot(store, result, finishedIso, loaded?.warnings, loaded?.errors);
  return { snapshot, worker: null, saved: mustSave };
}

async function promoteIndexer(storePath, home, snapshot, testStreamDelayMs = 0) {
  // Called only after the caller released the store lock: the child is then
  // the next writer and waits out any bounded handoff instead of livelocking.
  const worker = await ensureIndexer(storePath, home, {
    generation: snapshot.scan?.generation ?? null,
    ackMs: 0,
    testStreamDelayMs,
  });
  if (worker.pid) {
    snapshot.scan = { ...snapshot.scan, status: "running", workerPid: worker.pid };
  }
  return worker;
}

async function finishWorkerAck(snapshot, worker, storePath, workerAckMs) {
  if (!worker?.pid || !worker.spawned) return snapshot;
  const ack = await waitForIndexerAck(storePath, worker.claim, {
    timeoutMs: workerAckMs ?? DEFAULT_WORKER_ACK_MS,
  });
  if (ack.ok) {
    snapshot.scan = { ...snapshot.scan, status: "running", workerPid: worker.pid };
    return snapshot;
  }
  snapshot.warnings = [
    ...(snapshot.warnings ?? []),
    "The background indexer did not acknowledge startup; the next refresh retries it.",
  ];
  snapshot.scan = { ...snapshot.scan, status: "partial", workerPid: null };
  return snapshot;
}

async function snapshotWithStore(
  storePath,
  home,
  {
    rebuild = false,
    budgetMs = DEFAULT_SCAN_BUDGET_MS,
    now = Date.now,
    lockWaitMs,
    workerAckMs = DEFAULT_WORKER_ACK_MS,
    testStreamDelayMs = 0,
  } = {},
) {
  let baseline = null;
  let fence = null;
  if (rebuild) {
    baseline = await generationBaseline(storePath);
    fence = await bumpFence(storePath, baseline);
  }
  const lock = await runWithStoreLock(storePath, async () => {
    const loaded = await loadStore(storePath);
    const store = loaded.store;
    let dirty = loaded.dirty;
    const fenceNow = await readEffectiveFence(storePath, { now: now() });
    if (rebuild) {
      store.generation = Math.max(storeGeneration(store) + 1, fence?.generation ?? 0);
      clearCollectedData(store);
      store.scan = emptyScanState();
      store.scan.generation = store.generation;
      store.scan.startedAt = new Date(now()).toISOString();
      store.lastCompletedScanAt = null;
      dirty = true;
    } else if (fenceNow && !fenceNow.stale && fenceNow.generation > store.generation) {
      const nowIso = new Date(now()).toISOString();
      const snapshot = buildSnapshot(
        store,
        scanResultFromStore(store),
        nowIso,
        loaded.warnings,
        loaded.errors,
      );
      snapshot.scan = { ...snapshot.scan, status: "reconfiguring" };
      return { snapshot, worker: null, fenced: true };
    }

    if (await removeStalePendingFile(storePath, store, now)) dirty = true;
    if (store.scan.pendingFile) {
      const nowIso = new Date(now()).toISOString();
      if (dirty) await saveStore(storePath, store, { status: "partial", now: nowIso });
      const snapshot = buildSnapshot(
        store,
        scanResultFromStore(store),
        nowIso,
        loaded.warnings,
        loaded.errors,
      );
      snapshot.scan = { ...snapshot.scan, status: "partial" };
      return { snapshot, worker: null, promote: true, fenced: false };
    }

    const scanned = await scanAndPersist(storePath, home, store, {
      loaded,
      dirty,
      budgetMs,
      now,
      testStreamDelayMs,
      mode: "foreground",
      guard: async () => {
        const fenceAfter = await readEffectiveFence(storePath, { now: now() });
        return Boolean(fenceAfter && !fenceAfter.stale && fenceAfter.generation > store.generation);
      },
    });
    if (scanned.fenced) {
      // A configure/rebuild is waiting. Discard this slice rather than leak an
      // old-generation write; the committed store is still authoritative.
      const committed = await loadStore(storePath, { readOnly: true });
      const nowIso = new Date(now()).toISOString();
      const snapshot = buildSnapshot(
        committed.store,
        scanResultFromStore(committed.store),
        nowIso,
        loaded.warnings,
        loaded.errors,
      );
      snapshot.scan = { ...snapshot.scan, status: "reconfiguring" };
      return { snapshot, worker: null, fenced: true };
    }
    return { ...scanned, fenced: false };
  }, {
    waitMs: lockWaitMs ?? (rebuild ? CONFIGURE_LOCK_WAIT_MS : FOREGROUND_LOCK_WAIT_MS),
    meta: { role: "collector", generation: fence?.generation ?? null },
    signalWorker: rebuild,
    fenceGeneration: fence?.generation ?? null,
  });

  if (!lock.acquired) {
    if (rebuild && fence) await restoreFence(storePath, baseline);
    return busySnapshot(storePath, lock.owner, now);
  }
  const { snapshot, worker: lockedWorker, promote } = lock.value;
  const worker = promote
    ? await promoteIndexer(storePath, home, snapshot, testStreamDelayMs)
    : (lockedWorker ?? null);
  return finishWorkerAck(snapshot, worker, storePath, workerAckMs);
}

async function configureStore(
  storePath,
  home,
  rawConfig,
  {
    rebuild = false,
    budgetMs = DEFAULT_SCAN_BUDGET_MS,
    now = Date.now,
    lockWaitMs = CONFIGURE_LOCK_WAIT_MS,
    workerAckMs = DEFAULT_WORKER_ACK_MS,
    testStreamDelayMs = 0,
  } = {},
) {
  let config;
  try {
    const parsed = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
    config = migrateLoadedConfig(normalizeConfig(parsed)).config;
  } catch (error) {
    const invalid = new Error(`invalid --config: ${error.message}`);
    invalid.exitCode = 2;
    throw invalid;
  }

  const baseline = await generationBaseline(storePath);
  const fence = await bumpFence(storePath, baseline);
  let applied = false;
  try {
    const lock = await runWithStoreLock(storePath, async () => {
      const loaded = await loadStore(storePath);
      const store = loaded.store;
      let dirty = loaded.dirty;
      const previousGeneration = storeGeneration(store);
      store.generation = Math.max(previousGeneration + 1, fence.generation);
      let persistedGeneration = previousGeneration;
      let outcome = null;
      try {
        const previousStatus = store.scan.status;
        const configChanged = JSON.stringify(store.config) !== JSON.stringify(config);
        const mappingsChanged = sourcesSignature(store.config) !== sourcesSignature(config);
        const cleared = mappingsChanged || rebuild;
        if (cleared) {
          clearCollectedData(store);
          store.scan = emptyScanState();
          store.scan.generation = store.generation;
          store.scan.startedAt = new Date(now()).toISOString();
          store.lastCompletedScanAt = null;
          dirty = true;
        }
        if (configChanged) {
          store.config = config;
          dirty = true;
        }
        applied = true;
        // Persist accepted config first. Config acceptance is never reported as a
        // completed scan; retained committed data keeps its completed timestamp.
        const acceptedComplete = !cleared && previousStatus === "complete";
        const acceptedIso = new Date(now()).toISOString();
        if (dirty) {
          store.scan.generation = store.generation;
          store.scan.updatedAt = acceptedIso;
          await saveStore(storePath, store, {
            completed: false,
            status: acceptedComplete ? "complete" : "partial",
            now: acceptedIso,
          });
          persistedGeneration = store.generation;
          dirty = false;
        }

        if (await removeStalePendingFile(storePath, store, now)) dirty = true;
        if (store.scan.pendingFile) {
          const nowIso = new Date(now()).toISOString();
          if (dirty) {
            await saveStore(storePath, store, { status: "partial", now: nowIso });
            persistedGeneration = store.generation;
          }
          const snapshot = buildSnapshot(
            store,
            scanResultFromStore(store),
            nowIso,
            loaded.warnings,
            loaded.errors,
          );
          snapshot.scan = { ...snapshot.scan, status: "partial" };
          outcome = { snapshot, worker: null, promote: true };
          return outcome;
        }

        const scanned = await scanAndPersist(storePath, home, store, {
          loaded,
          dirty,
          budgetMs,
          now,
          testStreamDelayMs,
          mode: "configure",
          guard: async () => {
            const fenceAfter = await readEffectiveFence(storePath, { now: now() });
            return Boolean(fenceAfter && !fenceAfter.stale && fenceAfter.generation > store.generation);
          },
        });
        if (scanned.fenced) {
          // A newer configure is already queued; its generation fence owns the
          // next commit. Return committed data without writing this generation.
          const committed = await loadStore(storePath, { readOnly: true });
          const nowIso = new Date(now()).toISOString();
          const snapshot = buildSnapshot(
            committed.store,
            scanResultFromStore(committed.store),
            nowIso,
            loaded.warnings,
            loaded.errors,
          );
          snapshot.scan = { ...snapshot.scan, status: "reconfiguring" };
          outcome = { snapshot, worker: null };
          return outcome;
        }
        if (scanned.saved) persistedGeneration = store.generation;
        outcome = scanned;
        return outcome;
      } finally {
        // An unchanged settings save bumps the fence before it knows whether
        // a write is required. If this generation was not committed, put the
        // fence back so a live configure process cannot pin later snapshots
        // in "reconfiguring" until the fence expires.
        if (persistedGeneration < fence.generation) {
          await relaxFence(storePath, fence.generation, persistedGeneration);
          store.generation = persistedGeneration;
          if (store.scan) store.scan.generation = persistedGeneration;
          if (Number.isInteger(outcome?.snapshot?.scan?.generation)
            && outcome.snapshot.scan.generation !== persistedGeneration) {
            outcome.snapshot.scan = {
              ...outcome.snapshot.scan,
              generation: persistedGeneration,
            };
          }
        }
      }
    }, {
      waitMs: lockWaitMs,
      meta: { role: "configure", generation: fence.generation },
      signalWorker: true,
      fenceGeneration: fence.generation,
    });

    if (!lock.acquired) {
      if (!applied) await restoreFence(storePath, baseline);
      throw new Error("analytics store is busy; configuration was not applied");
    }
    const { snapshot, worker: lockedWorker, promote } = lock.value;
    const worker = promote
      ? await promoteIndexer(storePath, home, snapshot, testStreamDelayMs)
      : (lockedWorker ?? null);
    return finishWorkerAck(snapshot, worker, storePath, workerAckMs);
  } catch (error) {
    if (!applied) await restoreFence(storePath, baseline).catch(() => {});
    throw error;
  }
}

export async function run(argv) {
  const { command, options } = parseArgs(argv);
  if (options.help || !command) {
    return { exitCode: 0, stdout: "", stderr: `${usage()}\n` };
  }
  if (!["snapshot", "configure", "status"].includes(command)) {
    return { exitCode: 2, stdout: "", stderr: `unknown command ${command}\n${usage()}\n` };
  }
  if (!options.store) {
    return { exitCode: 2, stdout: "", stderr: "--store is required\n" };
  }
  if (command === "configure" && options.config === undefined) {
    return { exitCode: 2, stdout: "", stderr: "--config is required\n" };
  }
  const snapshot = await collectSnapshot(command, options);
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(snapshot)}\n`,
    stderr: "",
  };
}

/** In-process API: the presenter never serializes and reparses raw rows. */
export async function collectSnapshot(command, options) {
  if (!["snapshot", "configure", "status"].includes(command)) throw new Error("unknown collector command");
  if (!options?.store) throw new Error("--store is required");
  if (command === "configure" && options.config === undefined) throw new Error("--config is required");
  const storePath = path.resolve(options.store);
  const home = path.resolve(options.home ?? os.homedir());
  const now = typeof options.now === "function" ? options.now : Date.now;
  const shared = {
    budgetMs: options.budgetMs,
    now,
    lockWaitMs: options.lockWaitMs,
    workerAckMs: options.workerAckMs,
    testStreamDelayMs: options.testStreamDelayMs,
  };
  if (command === "status") {
    const owner = await readStoreLockInfo(storePath);
    return busySnapshot(storePath, owner, now);
  }
  return command === "snapshot"
    ? snapshotWithStore(storePath, home, { ...shared, rebuild: options.rebuild })
    : configureStore(storePath, home, options.config, { ...shared, rebuild: options.rebuild });
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`analytics collector: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}

function isInvokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(entry).href === import.meta.url;
  }
}

if (isInvokedDirectly()) {
  await main();
}
