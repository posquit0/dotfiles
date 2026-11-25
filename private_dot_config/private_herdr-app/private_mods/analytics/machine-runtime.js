// Runs through the selected Herdr core. Helpers are immutable and keyed by content;
// the machine's history/configuration store stays separate from the helper version.
export const REMOTE_ANALYTICS_SETUP = String.raw`
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 15)) throw new Error("Node 22.15 or newer is required on this machine.");
const data = gunzipSync(Buffer.from(process.argv[1], "base64"));
const hash = createHash("sha256").update(data).digest("hex");
const app = process.env.HERDR_APP_HOME || path.join(os.homedir(), ".config/herdr-app");
const store = path.join(app, "data/analytics/analytics.json");
const cache = path.join(app, "data/analytics/helpers");
const destination = path.join(cache, hash);
await mkdir(cache, { recursive: true, mode: 0o700 });
try { await readFile(path.join(destination, "presenter.mjs")); }
catch {
  const staging = await mkdtemp(path.join(cache, ".staging-"));
  try {
    for (const [name, source] of JSON.parse(data)) {
      if (!/^(?:core\/)?[a-z-]+\.(?:mjs|js|json)$/.test(name)) throw new Error("Invalid helper path");
      const target = path.join(staging, name);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, source, { mode: 0o600 });
    }
    try { await rename(staging, destination); }
    catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
process.stdout.write(JSON.stringify({ node: process.execPath, home: os.homedir(), presenter: path.join(destination, "presenter.mjs"), store }));
`;
