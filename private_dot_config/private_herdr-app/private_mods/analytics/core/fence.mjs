import { link, open, readFile, rename, unlink } from "node:fs/promises";
import os from "node:os";
import { randomBytes } from "node:crypto";
import {
  atomicWriteJson,
  isPlainObject,
  isProcessAlive,
  readJsonFile,
} from "./util.mjs";

// A generation fence is written BEFORE a configure/rebuild waits for the store
// lock. Any worker spawned for an older generation must stop and must not
// commit. The fence is advisory metadata next to the store (no transcript text)
// and is always written atomically with 0600 permissions.
const FENCE_VERSION = 1;
// A configure/rebuild holds its in-process work for seconds, never minutes.
// Only a provably dead local writer (or a long-abandoned fence) is ignored.
const FENCE_ABANDONED_MS = 10 * 60 * 1000;
// A claim may exist for a few milliseconds before the spawned pid is recorded.
export const WORKER_CLAIM_STARTUP_MS = 5_000;

export function fencePath(storePath) {
  return `${storePath}.generation.json`;
}

export function workerClaimPath(storePath) {
  return `${storePath}.worker.json`;
}

export function nextGeneration(...values) {
  let highest = 0;
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > highest) highest = number;
  }
  return highest + 1;
}

/**
 * Strict fence read for writer authority. A missing fence is a legitimate
 * "no configure queued" answer, but a corrupt/unreadable fence must NOT be
 * treated as absent: callers that gate commits fail closed on the thrown error.
 */
export async function readFenceStrict(storePath) {
  let text;
  try {
    text = await readFile(fencePath(storePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`analytics generation fence is unreadable: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(value) || value.version !== FENCE_VERSION
    || !Number.isInteger(value.generation) || value.generation < 1) {
    throw new Error("analytics generation fence is malformed");
  }
  return value;
}

export async function readFence(storePath) {
  try {
    const value = await readJsonFile(fencePath(storePath));
    if (!isPlainObject(value)) return null;
    if (value.version !== FENCE_VERSION) return null;
    if (!Number.isInteger(value.generation) || value.generation < 1) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * A fence from a crashed configure must not block indexing forever. Ignore it
 * only when its local owner is provably dead or it is far older than any real
 * configure. Never kill the pid here; the lock remains the sole writer gate.
 */
export async function readEffectiveFence(storePath, { now = Date.now() } = {}) {
  const fence = await readFence(storePath);
  if (!fence) return null;
  const age = now - Number(fence.at ?? 0);
  const sameHost = fence.host === os.hostname();
  const dead = sameHost && Number.isInteger(fence.pid) && !isProcessAlive(fence.pid);
  const abandoned = Number.isFinite(age) && age > FENCE_ABANDONED_MS;
  return { ...fence, stale: dead || abandoned };
}

export async function writeFence(storePath, generation) {
  const value = {
    version: FENCE_VERSION,
    generation,
    pid: process.pid,
    host: os.hostname(),
    at: Date.now(),
  };
  await atomicWriteJson(fencePath(storePath), value);
  return value;
}

/** Raise the fence above both the committed generation and any prior fence. */
export async function bumpFence(storePath, committedGeneration = 0) {
  const current = await readFence(storePath);
  const generation = nextGeneration(committedGeneration, current?.generation ?? 0);
  return writeFence(storePath, generation);
}

/** Best-effort undo for a configure that failed before it committed. */
export async function restoreFence(storePath, generation) {
  const current = await readFence(storePath);
  if (!current || current.pid !== process.pid) return false;
  if (current.generation <= generation) return false;
  await writeFence(storePath, generation);
  return true;
}

/**
 * Drop a fence this process still owns back to the committed generation.
 * A newer configure (different generation or pid) is left untouched. Generation
 * 0 removes the file; readers treat a missing fence as "no configure queued".
 */
export async function relaxFence(storePath, ownedGeneration, committedGeneration) {
  const current = await readFence(storePath);
  if (!current || current.pid !== process.pid) return false;
  if (current.generation !== ownedGeneration) return false;
  if (!Number.isInteger(committedGeneration) || committedGeneration >= ownedGeneration) return false;
  if (committedGeneration < 1) {
    await unlink(fencePath(storePath)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return true;
  }
  await writeFence(storePath, committedGeneration);
  return true;
}

/**
 * Startup readers must tell "reaped" apart from "publisher is mid-write".
 * A missing file is replacement. An empty or torn file is still the same claim
 * until the startup deadline; treating it as replacement kills a live worker.
 */
export async function readWorkerClaimResult(storePath) {
  let text;
  try {
    text = await readFile(workerClaimPath(storePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "pending" };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "pending" };
  }
  if (!isPlainObject(value) || typeof value.token !== "string" || value.token.length === 0) {
    return { status: "pending" };
  }
  if (!Number.isInteger(value.generation) || value.generation < 0) return { status: "pending" };
  return { status: "ok", claim: value };
}

export async function readWorkerClaim(storePath) {
  const result = await readWorkerClaimResult(storePath);
  return result.status === "ok" ? result.claim : null;
}

/** Token checks stay strict. Only an unreadable in-place publish is retried. */
export function classifyWorkerClaim(result, token, pid) {
  if (!result || result.status === "missing") return "replaced";
  if (result.status !== "ok") return "pending";
  if (result.claim?.token !== token) return "replaced";
  if (result.claim.pid === pid) return "ready";
  if (Number.isInteger(result.claim.pid) && result.claim.pid > 0) return "other";
  return "pending";
}

/**
 * Pid publication bytes. The record is never shorter than the previous file,
 * so the publisher does not have to truncate first. Trailing spaces are JSON
 * whitespace; a concurrent reader never observes an empty claim.
 */
export function claimPidRecord(currentText, next) {
  const body = JSON.stringify(next);
  const previousBytes = Buffer.byteLength(String(currentText ?? ""));
  const pad = Math.max(0, previousBytes - Buffer.byteLength(body) - 1);
  return `${body}${" ".repeat(pad)}\n`;
}

/**
 * Exclusive claim creation (O_CREAT|O_EXCL); never last-write-wins. Concurrent
 * launchers either create the claim or observe EEXIST and coalesce.
 */
export async function tryCreateWorkerClaim(storePath, claim) {
  const file = workerClaimPath(storePath);
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(claim)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    return true;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Record the spawned pid without clobbering a claim that was replaced
 * concurrently: the open handle pins the inode, so a rename by a reaper makes
 * this write land in the quarantined file instead of a newer claim.
 */
export async function updateWorkerClaimPid(storePath, token, pid) {
  let handle;
  try {
    handle = await open(workerClaimPath(storePath), "r+");
    const text = await handle.readFile("utf8");
    let current;
    try { current = JSON.parse(text); } catch { current = null; }
    if (!isPlainObject(current) || current.token !== token) return false;
    const next = { ...current, pid, at: Date.now() };
    // Overwrite in place at offset 0. Truncating first publishes an empty
    // claim, and the worker treats that as claim-replaced and exits.
    const content = claimPidRecord(text, next);
    await handle.write(content, 0, "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Token-safe release/reclaim. The claim file is renamed to a private
 * quarantine name first (atomic, single winner), then verified by token. A
 * claim that was replaced between observation and rename is restored with an
 * exclusive link so it is never destroyed by a stale reaper.
 */
export async function clearWorkerClaim(storePath, token) {
  const file = workerClaimPath(storePath);
  const quarantine = `${file}.${process.pid}-${randomBytes(6).toString("hex")}.reap`;
  try {
    await rename(file, quarantine);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  let current;
  try { current = JSON.parse(await readFile(quarantine, "utf8")); } catch { current = null; }
  if (current?.token !== token) {
    // We moved a claim that had already been replaced. Put it back only if the
    // slot is still empty; otherwise a newer claim exists and wins.
    try { await link(quarantine, file); } catch { /* newer claim present */ }
    await unlink(quarantine).catch(() => {});
    return false;
  }
  await unlink(quarantine).catch(() => {});
  return true;
}

/**
 * A claim is live while its recorded pid is alive. A claim without a pid is
 * only a spawn in progress; it expires quickly so a crashed launcher cannot
 * pin the store. A claim from another host fails closed (never spawn a second
 * long-lived writer against a possibly shared directory).
 */
export function workerClaimActive(claim, { now = Date.now() } = {}) {
  if (!claim) return false;
  if (claim.host !== os.hostname()) return true;
  if (Number.isInteger(claim.pid) && claim.pid > 0) return isProcessAlive(claim.pid);
  const age = now - Number(claim.at ?? claim.startedAt ?? 0);
  return Number.isFinite(age) && age < WORKER_CLAIM_STARTUP_MS;
}
