// Ship only the history helpers; credentials and session data never enter this bundle.
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const files = [
  "package.json", "analytics.js", "presenter.mjs", "collector.mjs", "indexer.mjs",
  ...["adapters", "antigravity", "cache", "config", "fence", "indexer-control", "progress", "scan", "store", "util"].map((name) => `core/${name}.mjs`),
];

export async function packRuntime(root = new URL("./", import.meta.url)) {
  const entries = await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, root), "utf8")]));
  return gzipSync(JSON.stringify(entries)).toString("base64");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(await packRuntime());
