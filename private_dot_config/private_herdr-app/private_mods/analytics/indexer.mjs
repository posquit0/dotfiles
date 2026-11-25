#!/usr/bin/env node
// Managed detached indexer for legitimate giant, non-seekable compressed
// archives that cannot finish inside a foreground exec slice. It keeps one
// streaming decoder alive to completion, owns the store writer lock, and
// commits completed files incrementally. No transcript text is stored.
//
// A decoder restart (after this process dies) re-reads only the open archive;
// Node exposes no zstd decoder-state snapshot, so continuing mid-frame is not
// promised. Polls never spawn or restart the decoder.
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyWorkerClaim,
  clearWorkerClaim,
  readEffectiveFence,
  readFenceStrict,
  readWorkerClaimResult,
} from "./core/fence.mjs";
import { progressWriter } from "./core/progress.mjs";
import { scanSources } from "./core/scan.mjs";
import {
  emptyScanState,
  ensureStoreMeta,
  loadStore,
  saveStore,
  storeGeneration,
} from "./core/store.mjs";
import { isLockBusyError, withStoreLock } from "./core/util.mjs";

const SAVE_INTERVAL_MS = 1_500;
const FENCE_POLL_MS = 250;
const CLAIM_WAIT_MS = 5_000;
// The launcher may still hold the store lock for a bounded moment after it
// published the pending file and spawned this process. Wait for that handoff
// instead of exiting on the first busy lock (which cleared the claim and
// livelocked promotion).
const HANDOFF_WAIT_MS = 5_000;

function parseArgs(argv) {
  const options = { testStreamDelayMs: 0, testFailAfterCheckpointMs: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const match = /^--(store|home|generation|claim-token|test-stream-delay-ms|test-fail-after-checkpoint)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unknown argument ${arg}`);
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
      if (value === undefined) throw new Error(`--${match[1]} needs a value`);
    }
    options[match[1]] = value;
  }
  for (const required of ["store", "home", "generation", "claim-token"]) {
    if (options[required] === undefined) throw new Error(`--${required} is required`);
  }
  const generation = Number(options.generation);
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error("--generation must be a non-negative integer");
  }
  const delay = Number(options["test-stream-delay-ms"]);
  return {
    storePath: path.resolve(options.store),
    home: path.resolve(options.home),
    generation,
    claimToken: options["claim-token"],
    testStreamDelayMs: Number.isFinite(delay) && delay > 0 ? delay : 0,
    testFailAfterCheckpointMs: Number(options["test-fail-after-checkpoint"] ?? options.testFailAfterCheckpointMs ?? 0) || 0,
  };
}

/**
 * Record a worker failure only under writer authority (inside the store lock),
 * immediately re-reading the committed generation so a newer configure or
 * rebuild can never be overwritten back to "failed".
 */
async function recordWorkerFailure(storePath, generation, error) {
  try {
    const loaded = await loadStore(storePath);
    ensureStoreMeta(loaded.store);
    if (storeGeneration(loaded.store) !== generation) return false;
    const scan = loaded.store.scan ?? emptyScanState();
    loaded.store.scan = scan;
    scan.status = "failed";
    scan.workerPid = null;
    scan.error = error.message;
    scan.updatedAt = new Date().toISOString();
    await saveStore(storePath, loaded.store, { status: "failed" });
    return true;
  } catch {
    return false;
  }
}

async function waitForClaim(storePath, token) {
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (;;) {
    const result = await readWorkerClaimResult(storePath);
    const decision = classifyWorkerClaim(result, token, process.pid);
    if (decision === "ready") return { ok: true, claim: result.claim };
    if (decision === "replaced") return { ok: false, reason: "claim-replaced" };
    if (decision === "other") return { ok: false, reason: "claim-other-pid" };
    if (Date.now() >= deadline) return { ok: false, reason: "claim-timeout" };
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

function scanViewUpdate(store, state, { status = "running" } = {}) {
  const scan = store.scan;
  scan.status = status;
  scan.generation = storeGeneration(store);
  scan.updatedAt = new Date().toISOString();
  scan.processed = Number.isInteger(state?.processed) ? state.processed : scan.processed;
  scan.total = Number.isInteger(state?.total) ? state.total : scan.total;
  if (state?.stats) scan.stats = state.stats;
  if (state?.sourceStats) scan.sourceStats = state.sourceStats;
  if (Array.isArray(state?.warnings)) scan.warnings = state.warnings;
  scan.currentFile = state?.file ?? null;
  return scan;
}

export async function runIndexer(argv) {
  const options = parseArgs(argv);
  const { storePath, home, generation, claimToken, testStreamDelayMs, testFailAfterCheckpointMs } = options;
  const claim = await waitForClaim(storePath, claimToken);
  if (!claim.ok) return { exitCode: 3, reason: claim.reason };

  let stopping = false;
  let fenceAborted = false;
  let fenceCheck = null;
  const onSignal = () => { stopping = true; };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const progress = progressWriter(storePath);
  // Metadata-only live view. Discovery counters survive stream updates so the
  // UI never loses the accepted progress while a single giant file decodes.
  let live = {
    processed: 0,
    total: 0,
    file: null,
    filesRead: 0,
    bytesRead: 0,
    decodedBytes: 0,
    phase: "scan",
  };
  const publishProgress = (state = {}) => {
    if (Number.isInteger(state.processed)) live.processed = state.processed;
    if (Number.isInteger(state.total)) live.total = state.total;
    if (typeof state.file === "string") live.file = state.file;
    if (typeof state.phase === "string") live.phase = state.phase;
    if (Number.isInteger(state.decodedBytes)) live.decodedBytes = state.decodedBytes;
    if (Number.isInteger(state.bytes)) live.decodedBytes = state.bytes;
    if (Number.isInteger(state.filesRead)) live.filesRead = state.filesRead;
    if (Number.isInteger(state.bytesRead)) live.bytesRead = state.bytesRead;
    if (Number.isInteger(state.stats?.filesRead)) live.filesRead = state.stats.filesRead;
    if (Number.isInteger(state.stats?.bytesRead)) live.bytesRead = state.stats.bytesRead;
    progress.update({
      ...live,
      mode: "worker",
      workerPid: process.pid,
      generation,
      token: claimToken,
      store: storePath,
    });
  };
  let lastSave = Date.now();
  try {
    const result = await withStoreLock(storePath, async () => {
      try {
      const loaded = await loadStore(storePath);
      const store = loaded.store;
      ensureStoreMeta(store);
      if (storeGeneration(store) !== generation) {
        return { exitCode: 0, reason: "stale-generation" };
      }
      // A corrupt or unreadable fence is not "no fence": fail closed before
      // this generation writes anything, rather than trusting a helper that
      // maps every read error to null.
      try {
        await readFenceStrict(storePath);
      } catch (error) {
        return { exitCode: 1, reason: "fence-unreadable", error };
      }
      const startFence = await readEffectiveFence(storePath);
      if (startFence && !startFence.stale && startFence.generation > generation) {
        return { exitCode: 0, reason: "fenced" };
      }

      store.scan.status = "running";
      store.scan.workerPid = process.pid;
      store.scan.generation = generation;
      store.scan.startedAt = store.scan.startedAt ?? new Date().toISOString();
      store.scan.currentFile = null;
      store.scan.error = null;
      if (store.scan.pendingFile?.path) {
        const pendingStat = await stat(store.scan.pendingFile.path).catch(() => null);
        if (!pendingStat?.isFile()) store.scan.pendingFile = null;
      }
      const startedIso = new Date().toISOString();
      await saveStore(storePath, store, { status: "running", now: startedIso });

      fenceCheck = async () => {
        if (fenceAborted) return;
        // Throws if the fence exists but cannot be trusted; callers treat that
        // as "do not commit" (fail closed). Missing fence stays legitimate.
        await readFenceStrict(storePath);
        const fence = await readEffectiveFence(storePath);
        if (fence && !fence.stale && fence.generation > generation) fenceAborted = true;
      };
      const fenceTimer = setInterval(() => {
        if (fenceAborted || stopping) return;
        fenceCheck().catch(() => { /* best-effort fence poll */ });
      }, FENCE_POLL_MS);
      fenceTimer.unref();

      let scanned;
      try {
        scanned = await scanSources(store, {
          home,
          deadline: null,
          mode: "worker",
          streamDelayMs: testStreamDelayMs,
          shouldStop: () => stopping || fenceAborted,
          onProgress: (state) => {
            publishProgress({ ...state, decodedBytes: 0 });
          },
          onStreamProgress: (state) => {
            publishProgress(state);
          },
          onCheckpoint: async (state) => {
            if (testFailAfterCheckpointMs > 0) {
              // Test hook: keep writer authority for a bounded window so a
              // concurrent client can queue on the lock, then fail.
              await new Promise((resolve) => setTimeout(resolve, testFailAfterCheckpointMs));
              throw new Error("injected indexer failure after checkpoint");
            }
            scanViewUpdate(store, state);
            store.scan.workerPid = process.pid;
            const finished = new Date().toISOString();
            publishProgress({
              processed: state.processed,
              total: state.total,
              file: state.file,
              filesRead: state.stats?.filesRead ?? 0,
              bytesRead: state.stats?.bytesRead ?? 0,
              decodedBytes: 0,
              phase: "scan",
            });
            if (Date.now() - lastSave >= SAVE_INTERVAL_MS) {
              // Never persist a checkpoint after this generation has been
              // fenced by configure/rebuild; fail closed if the fence cannot
              // be read so an old generation cannot leak a late commit.
              try {
                await fenceCheck();
              } catch {
                return;
              }
              if (fenceAborted) return;
              await saveStore(storePath, store, { status: "running", now: finished });
              lastSave = Date.now();
            }
          },
        });
      } finally {
        clearInterval(fenceTimer);
      }

      await fenceCheck();
      const finishedIso = new Date().toISOString();
      scanViewUpdate(store, scanned, {
        status: scanned.complete ? "complete" : "partial",
      });
      store.scan.currentFile = null;
      store.scan.workerPid = null;
      if (scanned.abortedFile) {
        store.scan.pendingFile = { ...scanned.abortedFile, requestedAt: finishedIso };
        store.scan.status = "partial";
      } else if (scanned.complete) {
        store.scan.pendingFile = null;
        store.scan.completedAt = finishedIso;
      }
      if (fenceAborted) {
        // A configure/rebuild owns the next generation. Leave the last
        // committed files intact and write nothing from this open generation.
        return { exitCode: 0, reason: "fenced" };
      }
      if (scanned.complete) {
        await saveStore(storePath, store, { completed: true, now: finishedIso });
      } else {
        await saveStore(storePath, store, { status: "partial", now: finishedIso });
      }
      return {
        exitCode: 0,
        reason: scanned.complete ? "complete" : (stopping ? "stopped" : "partial"),
      };
      } catch (error) {
        // Still inside the lock: the failure status is written under the same
        // writer authority as every other commit, then the lock is released.
        await recordWorkerFailure(storePath, generation, error);
        return { exitCode: 1, reason: "error", error };
      }
    }, {
      timeoutMs: HANDOFF_WAIT_MS,
      meta: { role: "worker", generation },
    });
    return result ?? { exitCode: 0 };
  } catch (error) {
    // Lock was never held: report without writing any store state.
    if (isLockBusyError(error)) return { exitCode: 0, reason: "lock-busy" };
    return { exitCode: 1, reason: "error", error };
  } finally {
    progress.clear();
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    await clearWorkerClaim(storePath, claimToken).catch(() => {});
  }
}

async function main() {
  try {
    const result = await runIndexer(process.argv.slice(2));
    process.exitCode = result.exitCode ?? 0;
  } catch (error) {
    process.stderr.write(`analytics indexer: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function isInvokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) await main();
