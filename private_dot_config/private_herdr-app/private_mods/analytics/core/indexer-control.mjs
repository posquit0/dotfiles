import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  clearWorkerClaim,
  readEffectiveFence,
  readWorkerClaim,
  tryCreateWorkerClaim,
  updateWorkerClaimPid,
  workerClaimActive,
} from "./fence.mjs";
import { isProcessAlive, readStoreLockInfo, sleep } from "./util.mjs";

export const DEFAULT_WORKER_ACK_MS = 1_500;

export function indexerPath() {
  return fileURLToPath(new URL("../indexer.mjs", import.meta.url));
}

function claimToken() {
  return `${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`;
}

/**
 * Ensure one detached local indexer is responsible for the store. The store
 * writer lock remains the authority; this claim only coalesces spawns so
 * several panes do not create several long-lived workers. A live claim is
 * never evicted; only a provably dead local pid (or an unfinished spawn) is.
 */
export async function ensureIndexer(
  storePath,
  home,
  {
    generation = null,
    ackMs = 0,
    testStreamDelayMs = 0,
    testWorkerPath = null,
  } = {},
) {
  const existing = await readWorkerClaim(storePath);
  if (workerClaimActive(existing)) {
    return { spawned: false, pid: Number.isInteger(existing.pid) ? existing.pid : null, claim: existing };
  }
  if (existing) {
    // A live claim (including a foreign host) is handled above. Only a
    // provably dead local pid or an expired spawn placeholder is reaped, and
    // only under the exact token we observed.
    await clearWorkerClaim(storePath, existing.token);
    const reread = await readWorkerClaim(storePath);
    if (workerClaimActive(reread)) {
      return { spawned: false, pid: Number.isInteger(reread.pid) ? reread.pid : null, claim: reread };
    }
  }

  const claim = {
    version: 1,
    token: claimToken(),
    pid: null,
    host: os.hostname(),
    generation: Number.isInteger(generation) ? generation : 0,
    startedAt: Date.now(),
    at: Date.now(),
  };
  // The worker waits briefly for its pid to be recorded, so publishing the
  // token before spawn makes concurrent launchers coalesce even during spawn.
  // Exclusive create, not last-write-wins: a launcher that loses EEXIST never
  // overwrites the winner's claim.
  if (!(await tryCreateWorkerClaim(storePath, claim))) {
    const other = await readWorkerClaim(storePath);
    return { spawned: false, pid: Number.isInteger(other?.pid) ? other.pid : null, claim: other };
  }

  const args = [
    testWorkerPath ?? indexerPath(),
    "--store", storePath,
    "--home", home,
    "--generation", String(claim.generation),
    "--claim-token", claim.token,
  ];
  if (Number.isFinite(testStreamDelayMs) && testStreamDelayMs > 0) {
    args.push("--test-stream-delay-ms", String(testStreamDelayMs));
  }

  let child;
  try {
    child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      env: { ...process.env },
    });
  } catch (error) {
    await clearWorkerClaim(storePath, claim.token);
    return { spawned: false, pid: null, error };
  }
  // A detached child's process handle must not keep this presenter alive.
  child.unref();
  child.on("error", () => { /* startup failure is observed through the claim */ });

  const recorded = { ...claim, pid: child.pid, at: Date.now() };
  try {
    const published = await updateWorkerClaimPid(storePath, claim.token, child.pid);
    if (!published) {
      // The claim was reaped/replaced while spawning; do not resurrect it. The
      // child will observe the missing/replaced token and exit without work.
      return { spawned: false, pid: null, claim: recorded, lostClaim: true };
    }
  } catch (error) {
    await clearWorkerClaim(storePath, claim.token);
    return { spawned: false, pid: null, error };
  }

  if (ackMs > 0) {
    const ack = await waitForIndexerAck(storePath, recorded, { timeoutMs: ackMs });
    return { ...ack, spawned: true, pid: child.pid, claim: recorded };
  }
  return { spawned: true, pid: child.pid, claim: recorded, alive: isProcessAlive(child.pid) };
}

/** Bounded acknowledgement that the spawned worker became the lock owner. */
export async function waitForIndexerAck(storePath, claim, { timeoutMs = DEFAULT_WORKER_ACK_MS } = {}) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const owner = await readStoreLockInfo(storePath);
    if (owner && Number.isInteger(claim?.pid) && owner.pid === claim.pid) {
      return { ok: true, pid: claim.pid, owner };
    }
    if (Number.isInteger(claim?.pid) && claim.pid > 0 && !isProcessAlive(claim.pid)) {
      const fence = await readEffectiveFence(storePath);
      return { ok: false, pid: claim.pid, exited: true, fence };
    }
    if (Date.now() >= deadline) {
      return { ok: false, pid: claim?.pid ?? null, timedOut: true };
    }
    await sleep(40);
  }
}
