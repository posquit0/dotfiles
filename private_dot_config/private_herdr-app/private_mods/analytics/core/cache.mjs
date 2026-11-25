import { readFile, stat } from "node:fs/promises";
import { atomicWriteJson, isPlainObject } from "./util.mjs";

// The dashboard and status paths must stay fast while a long indexer holds the
// writer lock. This sidecar is a compact, metadata-only copy of the committed
// aggregate rows plus the truthful scan state. It is always derived from the
// committed store and is never read as a source for mutation.
const CACHE_VERSION = 2;
const FINGERPRINT_FIELDS = ["dev", "ino", "size", "mtimeNs"];

export function presentationCachePath(storePath) {
  return `${storePath}.cache.json`;
}

/**
 * Exact identity of one committed atomic store revision. The publisher calls
 * this only after its store rename while still holding the writer lock, so a
 * cache can never inherit a newer revision's fingerprint by racing a commit.
 */
export async function storeRevisionFingerprint(storePath) {
  const info = await stat(storePath, { bigint: true });
  if (!info.isFile()) return null;
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
  };
}

function validFingerprint(value) {
  return isPlainObject(value)
    && FINGERPRINT_FIELDS.every((field) => typeof value[field] === "string" && value[field]);
}

function sameFingerprint(left, right) {
  return validFingerprint(left)
    && validFingerprint(right)
    && FINGERPRINT_FIELDS.every((field) => left[field] === right[field]);
}

export async function writePresentationCache(
  storePath,
  { savedAt, store, rows, fingerprint },
) {
  if (!validFingerprint(fingerprint)) {
    throw new Error("presentation cache requires the committed store fingerprint");
  }
  const scan = isPlainObject(store?.scan) ? store.scan : {};
  const value = {
    version: CACHE_VERSION,
    savedAt: savedAt ?? store?.lastScanAt ?? null,
    lastScanAt: store?.lastScanAt ?? null,
    lastCompletedScanAt: store?.lastCompletedScanAt ?? null,
    generation: Number.isInteger(store?.generation) ? store.generation : 0,
    config: store?.config ?? {},
    rows: Array.isArray(rows) ? rows : [],
    scan,
    storeFingerprint: fingerprint,
  };
  await atomicWriteJson(presentationCachePath(storePath), value);
  return value;
}

function validCache(value) {
  return Boolean(
    isPlainObject(value)
      && value.version === CACHE_VERSION
      && isPlainObject(value.config)
      && Array.isArray(value.rows)
      && isPlainObject(value.scan)
      && (value.lastScanAt === null || typeof value.lastScanAt === "string")
      && (value.lastCompletedScanAt === null || typeof value.lastCompletedScanAt === "string")
      && Number.isInteger(value.generation)
      && value.generation >= 0
      && validFingerprint(value.storeFingerprint),
  );
}

/**
 * Returns the cached presentation data only when it was derived from the exact
 * committed store revision that is visible now. A missing, legacy (un-
 * fingerprinted), corrupt, mismatched, or concurrently replaced cache falls
 * back to the full store so prepare never invents or serves old data.
 */
export async function readPresentationCache(storePath) {
  try {
    const before = await storeRevisionFingerprint(storePath);
    if (!before) return null;
    const text = await readFile(presentationCachePath(storePath), "utf8");
    const after = await storeRevisionFingerprint(storePath);
    // A commit that landed while the cache was being read makes the cache
    // ambiguous; use the committed store instead of guessing.
    if (!sameFingerprint(before, after)) return null;
    const value = JSON.parse(text);
    if (!validCache(value)) return null;
    if (!sameFingerprint(value.storeFingerprint, after)) return null;
    return value;
  } catch {
    return null;
  }
}
