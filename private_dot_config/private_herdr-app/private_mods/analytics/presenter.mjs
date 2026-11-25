#!/usr/bin/env node
// Node presentation helper for Analytics.
//
// QuickJS receives only a compact dashboard payload. The full snapshot rows and
// the pure analytics derivation stay in Node, where a filter change can also be
// prepared from the existing store without scanning transcripts again.
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESENTATION_VERSION,
  compactDashboard,
  deriveDashboard,
} from "./analytics.js";
import { collectSnapshot, readCommittedSnapshot } from "./collector.mjs";

function usage() {
  return [
    "Usage:",
    "  presenter.mjs snapshot --store <file> --home <dir> [--options <json>]",
    "  presenter.mjs configure --store <file> --home <dir> --config <json> [--options <json>]",
    "  presenter.mjs prepare --store <file> [--options <json>]",
    "  presenter.mjs status --store <file> [--options <json>]",
  ].join("\n");
}

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(store|home|config|options)(?:=(.*))?$/.exec(arg);
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

function parseOptions(raw) {
  if (raw === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const invalid = new Error(`invalid --options: ${error.message}`);
    invalid.exitCode = 2;
    throw invalid;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const invalid = new Error("invalid --options: expected one JSON object");
    invalid.exitCode = 2;
    throw invalid;
  }
  return parsed;
}

function compactSnapshot(snapshot, rowCount = 0) {
  const {
    version = 1,
    generatedAt = null,
    lastScanAt = null,
    lastCompletedScanAt = null,
    savedAt = null,
    config = {},
    stats,
    sourceStats,
    scan,
    warnings = [],
  } = snapshot ?? {};
  return {
    version,
    generatedAt,
    lastScanAt,
    lastCompletedScanAt,
    savedAt,
    config,
    rowCount: Array.isArray(snapshot?.rows)
      ? snapshot.rows.length
      : Number.isFinite(Number(rowCount))
        ? Number(rowCount)
        : 0,
    stats,
    sourceStats,
    scan: scan && typeof scan === "object" ? scan : null,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

function presentation(command, snapshot, options, dashboard, error) {
  return {
    version: PRESENTATION_VERSION,
    kind: "analytics-presentation",
    command,
    options,
    snapshot: compactSnapshot(snapshot),
    dashboard: dashboard ? compactDashboard(dashboard) : null,
    error: error ? String(error.message ?? error) : null,
  };
}

function derive(snapshot, options) {
  try {
    return { dashboard: deriveDashboard(snapshot, options), error: null };
  } catch (error) {
    return { dashboard: null, error };
  }
}

export async function run(argv, environment = {}) {
  const { command, options } = parseArgs(argv);
  if (options.help || !command) {
    return { exitCode: 0, stdout: "", stderr: `${usage()}\n` };
  }
  if (!["snapshot", "configure", "prepare", "status"].includes(command)) {
    return { exitCode: 2, stdout: "", stderr: `unknown command ${command}\n${usage()}\n` };
  }
  if (!options.store) {
    return { exitCode: 2, stdout: "", stderr: "--store is required\n" };
  }
  if (command === "configure" && options.config === undefined) {
    return { exitCode: 2, stdout: "", stderr: "--config is required\n" };
  }

  const storePath = path.resolve(options.store);
  const home = path.resolve(options.home ?? environment.home ?? os.homedir());
  const dashboardOptions = parseOptions(options.options);

  if (command === "prepare" || command === "status") {
    // Never takes the writer lock: a long indexer must not block the cached UI.
    const snapshot = await readCommittedSnapshot(storePath);
    const derived = derive(snapshot, dashboardOptions);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(presentation(command, snapshot, dashboardOptions, derived.dashboard, derived.error))}\n`,
      stderr: "",
    };
  }

  const snapshot = await collectSnapshot(command, {
    store: storePath, home, config: options.config,
  });
  const derived = derive(snapshot, dashboardOptions);
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(presentation(command, snapshot, dashboardOptions, derived.dashboard, derived.error))}\n`,
    stderr: "",
  };
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    if (error.stderr) process.stderr.write(String(error.stderr));
    else process.stderr.write(`analytics presenter: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}

if (isEntryPoint()) await main();
