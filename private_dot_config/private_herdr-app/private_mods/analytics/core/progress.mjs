import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isPlainObject } from "./util.mjs";

const MAX_FILE_CHARS = 4_096;
const ALLOWED_PHASES = new Set(["scan", "decompress"]);

function nonNegInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function shortString(value, max = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * Metadata-only allowlist for the live progress sidecar. Unknown fields (rows,
 * config, accounting, arbitrary diagnostics) are dropped before they can reach
 * a presentation snapshot. Full identity is required: a foreground sidecar
 * without a worker pid/token is deliberately not a live-worker overlay.
 */
export function liveProgressView(value) {
  if (!isPlainObject(value)) return null;
  const pid = nonNegInt(value.workerPid ?? value.pid);
  const generation = nonNegInt(value.generation);
  const token = shortString(value.token);
  const store = shortString(value.store, 8_192);
  if (!pid || pid <= 0 || generation === null || !token || !store) return null;
  const file = shortString(value.file, MAX_FILE_CHARS);
  const phase = ALLOWED_PHASES.has(value.phase) ? value.phase : null;
  return {
    pid,
    generation,
    token,
    store,
    file,
    phase,
    processed: nonNegInt(value.processed),
    total: nonNegInt(value.total),
    filesRead: nonNegInt(value.filesRead),
    bytesRead: nonNegInt(value.bytesRead),
    decodedBytes: nonNegInt(value.decodedBytes ?? value.bytes),
    updatedAt: shortString(value.updatedAt, 64),
  };
}

/** Read and sanitize the best-effort progress sidecar; missing/corrupt is null. */
export async function readLiveProgress(storePath) {
  try {
    return liveProgressView(JSON.parse(await readFile(`${storePath}.progress.json`, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Best-effort scan progress sidecar next to the store. The native view polls
 * it while a refresh or background indexer is running; it is removed when the
 * writer settles. It contains paths and counters only, never transcript text.
 */
export function progressWriter(storePath) {
  const progressPath = `${storePath}.progress.json`;
  const tempPath = `${progressPath}.${process.pid}-${randomUUID()}.tmp`;
  let lastWrite = 0;
  return {
    update(state) {
      const now = Date.now();
      const done = Number(state?.processed) >= Number(state?.total) && Number(state?.total) > 0;
      if (now - lastWrite < 250 && !done) return;
      lastWrite = now;
      try {
        // Atomic replacement also avoids following an existing sidecar link.
        const payload = { ...state, updatedAt: new Date(now).toISOString() };
        writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
        renameSync(tempPath, progressPath);
      } catch { /* progress is best-effort */ }
      finally {
        try { unlinkSync(tempPath); } catch { /* renamed or not created */ }
      }
    },
    clear() {
      try {
        unlinkSync(progressPath);
      } catch { /* already gone */ }
    },
  };
}
