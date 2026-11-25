import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  constants as fsConstants,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const STORE_VERSION = 1;
export const STORE_LOCK_STALE_MS = 10 * 60 * 1000;
export const MAX_LINE_BYTES = 16 * 1024 * 1024;
// A turn without harness-reported task boundaries is capped. This keeps idle
// time from becoming active time without inventing sub-minute precision.
export const MAX_TURN_MS = 2 * 60 * 60 * 1000;

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value, fallback = "unknown") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function expandHome(input, home) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  if (input.startsWith("~")) return path.join(home, input.slice(1));
  return path.resolve(home, input);
}

export function toNonNegInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeTokens(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const out = {
    input: toNonNegInt(source.input),
    output: toNonNegInt(source.output),
    cacheRead: toNonNegInt(source.cacheRead),
    cacheWrite: toNonNegInt(source.cacheWrite),
    reasoning: toNonNegInt(source.reasoning),
  };
  out.nonzero =
    out.input > 0 ||
    out.output > 0 ||
    out.cacheRead > 0 ||
    out.cacheWrite > 0;
  if (!out.nonzero && out.reasoning > 0) out.nonzero = true;
  return out;
}

export function tokenTotal(tokens) {
  return (
    toNonNegInt(tokens?.input) +
    toNonNegInt(tokens?.output) +
    toNonNegInt(tokens?.cacheRead) +
    toNonNegInt(tokens?.cacheWrite)
  );
}

export function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e14) return Math.floor(value / 1000); // microseconds
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    return Math.floor(value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return parseTimestamp(Number(text));
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function localDay(ms) {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hashKey(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(typeof part === "string" ? part : JSON.stringify(part));
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 24);
}

export function sessionHash(session) {
  return hashKey("session", session);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function tempSibling(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
  );
}

export async function ensureParent(file, mode = 0o700) {
  await mkdir(path.dirname(file), { recursive: true, mode });
}

export async function atomicWriteJson(file, value) {
  await ensureParent(file);
  const temp = tempSibling(file);
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => {});
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function readJsonFile(file) {
  const text = await readFile(file, "utf8");
  return JSON.parse(text);
}

export async function backupCorruptStore(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${file}.corrupt-${stamp}`;
  for (let index = 0; index < 100; index += 1) {
    const target = index === 0 ? base : `${base}-${index}`;
    try {
      await copyFile(file, target, fsConstants.COPYFILE_EXCL);
      await chmod(target, 0o600).catch(() => {});
      return target;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not preserve corrupt store ${file}`);
}

async function readLockInfo(lockPath) {
  let ownerPath = lockPath;
  let directory = false;
  try {
    if ((await stat(lockPath)).isDirectory()) {
      directory = true;
      const owners = (await readdir(lockPath)).filter((name) => /^owner-.+\.json$/.test(name));
      // An empty acquisition directory has no provable dead owner. Fail closed.
      if (owners.length !== 1) return { invalid: true, directory };
      ownerPath = path.join(lockPath, owners[0]);
    }
    const value = JSON.parse(await readFile(ownerPath, "utf8"));
    return isPlainObject(value) ? { ...value, ownerPath, directory } : { invalid: true, directory };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { invalid: true, directory };
  }
}

async function lockAgeMs(lockPath) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs;
  } catch {
    return 0;
  }
}

async function tryUnlinkStaleLock(lockPath, observed) {
  const current = await readLockInfo(lockPath);
  if (!current) return true;
  if (observed?.token && current.token !== observed.token) return false;
  if (!observed?.token && current.token) return false;
  if (observed?.directory) {
    if (!observed.ownerPath || current.ownerPath !== observed.ownerPath) return false;
    try {
      // Only the reclaimer that removed this unique owner file may remove the
      // directory. A delayed second reclaimer cannot delete a new owner's lock.
      await unlink(observed.ownerPath);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    await rmdir(lockPath).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    });
    return true;
  }
  // Compatibility with older file locks. unlink cannot remove a new directory
  // lock if another reclaimer has already replaced the legacy lock.
  await unlink(lockPath).catch((error) => {
    if (!["ENOENT", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  });
  return true;
}

async function quarantineLockDirectory(lockPath, token) {
  const quarantine = `${lockPath}.release-${token}`;
  try {
    // A rename is atomic: no observer can see the lock directory emptied and
    // later removed in separate steps. A crash leaves only the quarantine dir.
    await rename(lockPath, quarantine);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => {});
}

export async function withStoreLock(
  storePath,
  callback,
  { timeoutMs = 20_000, staleMs = STORE_LOCK_STALE_MS, meta = {} } = {},
) {
  const lockPath = `${storePath}.lock`;
  await ensureParent(lockPath);
  const token = `${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const host = os.hostname();
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const ownerName = `owner-${token}.json`;
  const ownerPath = path.join(lockPath, ownerName);
  // Publish a fully populated unique directory with one atomic rename. Crash
  // windows before this point leave only a private staging directory that no
  // writer mistakes for the lock.
  const stagingPath = path.join(
    path.dirname(lockPath),
    `.${path.basename(lockPath)}.acquire-${token}`,
  );
  try {
    await mkdir(stagingPath, { mode: 0o700 });
    const handle = await open(path.join(stagingPath, ownerName), "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ ...meta, pid: process.pid, host, startedAt, token })}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close().catch(() => {});
    }
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  try {
    for (;;) {
      const observed = await readLockInfo(lockPath);
      if (!observed) {
        try {
          await rename(stagingPath, lockPath);
          break;
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(error?.code)) {
            throw error;
          }
          // A writer won the race between the existence check and the rename.
        }
      }
      const current = observed ?? await readLockInfo(lockPath);
      const age = await lockAgeMs(lockPath);
      const sameHost = current?.host === host;
      const pid = Number(current?.pid);
      const dead = sameHost && Number.isInteger(pid) && !isProcessAlive(pid);
      // Only provably dead local owners can be evicted. Foreign/empty locks
      // fail closed rather than allowing two writers based on elapsed time.
      const malformedOld = !current?.directory && current?.invalid
        && age > Math.max(staleMs, 60_000);

      if (dead || malformedOld) {
        const removed = await tryUnlinkStaleLock(lockPath, current);
        if (removed) continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`analytics store is busy (lock ${lockPath})`);
      }
      await sleep(60 + Math.floor(Math.random() * 40));
    }
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  try {
    return await callback();
  } finally {
    const current = await readLockInfo(lockPath);
    if (current?.token === token) {
      try {
        await quarantineLockDirectory(lockPath, token);
      } catch {
        // Conservative fallback for platforms/filesystems that cannot rename
        // the directory. It is only taken after the owner token matched.
        await unlink(ownerPath).catch(() => {});
        await rmdir(lockPath).catch(() => {});
      }
    }
  }
}

/** The committed lock owner, if any. Used for fast status responses. */
export async function readStoreLockInfo(storePath) {
  return readLockInfo(`${storePath}.lock`);
}

export function isLockBusyError(error) {
  return /analytics store is busy/.test(String(error?.message ?? ""));
}
