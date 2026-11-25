import { cacheImage } from "./media.mjs";
import { generateText } from "./ai.mjs";
import { githubActions } from "./model.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, unlink, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const digest = value => createHash("sha256").update(value).digest("hex");
const text = (value, name = "value") => {
  if (typeof value !== "string" || value.includes("\0") || value.length > 60000) throw new Error(`Invalid ${name}`);
  return value;
};
const required = (value, name) => { text(value, name); if (!value.trim()) throw new Error(`${name} is required`); return value; };
const id = value => { if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error("Invalid GitHub ID"); return String(value); };
const ref = value => { required(value, "reference"); if (value.startsWith("-")) throw new Error("Invalid reference"); return value; };
const oid = value => { if (!/^[a-f0-9]{40,64}$/.test(value ?? "")) throw new Error("Invalid commit ID"); return value; };
const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];

export function execute(program, args, { cwd, input, timeout = 120000, signal, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GIT_PAGER: "cat", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, failure; const chunks = [];
    const abort = () => { failure = new Error("Generation cancelled"); child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { failure = new Error(`${program} timed out`); child.kill("SIGKILL"); }, timeout);
    const collect = stream => data => {
      bytes += data.length;
      if (bytes > 6 * 1024 * 1024) { failure = new Error("Output exceeds 6 MiB; narrow the selection and retry"); child.kill("SIGKILL"); }
      else if (stream === "out") { if (binary) chunks.push(data); else stdout += data; } else stderr += data;
    };
    if (!binary) child.stdout.setEncoding("utf8");
    child.stdout.on("data", collect("out"));
    child.stderr.setEncoding("utf8").on("data", collect("err"));
    child.on("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.on("close", code => { clearTimeout(timer); signal?.removeEventListener("abort", abort); failure ? reject(failure) : resolve({ code, stdout: binary ? Buffer.concat(chunks) : stdout, stderr }); });
    child.stdin.on("error", () => {}); // A failed process can close stdin before consuming it.
    child.stdin.end(input ?? "");
  });
}

export function parseStatus(raw) {
  return raw.split("\0").filter(Boolean).map(entry => {
    const xy = entry.slice(0, 2), file = entry.slice(3);
    return { path: file, xy, untracked: xy === "??", staged: xy !== "??" && xy[0] !== " ", unstaged: xy === "??" || xy[1] !== " ", conflict: /U/.test(xy) || ["AA", "DD"].includes(xy) };
  });
}
export function parseStats(raw) {
  return raw.split("\0").filter(Boolean).map(entry => {
    const [add, del, ...name] = entry.split("\t");
    return { path: name.join("\t"), add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" };
  });
}
export function splitPatch(patch) {
  const lines = patch.split(/(?<=\n)/), first = lines.findIndex(line => line.startsWith("@@ "));
  if (first < 0) return { header: patch, hunks: [] };
  const hunks = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith("@@ ")) hunks.push(line);
    else if (hunks.length) hunks[hunks.length - 1] += line;
  }
  return { header: lines.slice(0, first).join(""), hunks };
}

export function selectHunkLines(hunk, selected, reverse = false) {
  const lines = hunk.split(/(?<=\n)/), header = lines.shift();
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)\n$/.exec(header);
  if (!match || !selected.length) throw new Error("Select changed lines in one hunk");
  const keep = new Set(selected), body = []; let previousKept = false, changed = 0;
  lines.forEach((line, index) => {
    if (line.startsWith("\\")) { if (previousKept) body.push(line); return; }
    if (line[0] === "+" || line[0] === "-") {
      if (keep.has(index + 1)) { body.push(line); previousKept = true; changed++; }
      else if (line[0] === (reverse ? "+" : "-")) { body.push(` ${line.slice(1)}`); previousKept = true; }
      else previousKept = false;
    } else { body.push(line); previousKept = true; }
  });
  if (!changed) throw new Error("Select added or deleted lines");
  const before = body.filter(line => line[0] === " " || line[0] === "-").length;
  const after = body.filter(line => line[0] === " " || line[0] === "+").length;
  return `@@ -${match[1]},${before} +${match[2]},${after} @@${match[3]}\n${body.join("")}`;
}

export function createService(runner = execute, { imageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/gitdeck-images") } = {}) {
  return async function service(request) {
    const r = request, cwd = required(r.cwd, "working directory");
    if (r.githubRepository && (!githubActions.has(r.action) || !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(r.githubRepository))) throw new Error("Invalid linked PR repository or action");
    if (!path.isAbsolute(cwd)) throw new Error("Working directory must be absolute");
    const call = async (program, args, options = {}) => {
      const result = await runner(program, args, { cwd, ...options });
      if (result.code !== 0 && !options.allowFailure) throw new Error((result.stderr || result.stdout || `${program} exited ${result.code}`).trim());
      return result;
    };
    const git = async (args, options) => (await call("git", [...READ, ...args], options)).stdout;
    const maybe = async args => (await call("git", [...READ, ...args], { allowFailure: true })).stdout.trim();
    const root = (await git(["rev-parse", "--show-toplevel"])).trim();
    if (r.root && r.root !== root) throw new Error("Repository changed. Refresh before continuing.");
    const head = await maybe(["rev-parse", "--verify", "HEAD"]);
    if (r.action === "noteTargets" || r.action === "sendNotes") {
      const facts = async address => {
        if (!/^t[a-z0-9]+$/.test(address || "")) throw new Error("Choose a local agent terminal");
        const terminal = JSON.parse((await call("hc", ["get", address, "--json"])).stdout);
        if (terminal.state !== "live" || !terminal.status?.app || !["idle", "working"].includes(terminal.status.state) || !terminal.foreground?.pid) throw new Error("Agent is not ready to receive notes");
        const cwd = terminal.foreground.cwd;
        const agentRoot = (await call("git", [...READ, "-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim();
        if (agentRoot !== root) throw new Error("Agent moved to a different repository");
        return { address, pid: terminal.foreground.pid, created: terminal.created_ms, app: terminal.status.app, state: terminal.status.state, cwd,
          title: terminal.name || terminal.status.title || terminal.status.app };
      };
      if (r.action === "noteTargets") {
        const list = JSON.parse((await call("hc", ["ls", "--json"])).stdout), targets = [];
        for (const terminal of list.terminals) {
          if (!/^t[a-z0-9]+$/.test(terminal.address || "")) continue;
          try { targets.push(await facts(terminal.address)); } catch { /* Other repositories, shells, and unavailable agents are not targets. */ }
        }
        return targets;
      }
      if (!r.confirm) throw new Error("Review the agent and notes before sending");
      const target = await facts(r.target?.address);
      if (target.pid !== r.target.pid || target.created !== r.target.created || target.app !== r.target.app || target.cwd !== r.target.cwd) throw new Error("Agent changed. Refresh the target list before sending.");
      const result = JSON.parse((await call("hc", ["send", target.address, "--if", target.state, "--json", "--", required(r.body, "Notes")])).stdout);
      if (!Number.isSafeInteger(result.turn) || result.turn < 0) throw new Error("Delivery could not be confirmed. Notes are kept; check the agent before retrying.");
      return { delivered: true, turn: result.turn, address: target.address };
    }
    const branch = await maybe(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const status = async () => parseStatus(await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]));
    const indexHash = async () => digest(await git(["diff", "--cached", "--binary", ...DIFF]));
    const assertHead = () => { if (r.head !== head) throw new Error("HEAD changed. Refresh and review before retrying."); };
    const filePath = (input = r.path) => {
      const file = required(input, "file path");
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("File must be inside the repository");
      return file;
    };
    // All file operations are relative to the repository root, even from a nested terminal cwd.
    const atRoot = async (args, options) => (await call("git", [...READ, ...args], { cwd: root, ...options })).stdout;
    const patchFor = async (file = filePath(), layer = r.layer, binary = false) => {
      const format = [...DIFF, ...(binary ? ["--binary"] : []), ...(r.fullContext ? ["--unified=100000"] : [])];
      if (layer === "commit") return atRoot(["show", "--format=", ...format, oid(r.commit), "--", file]);
      if (layer === "base" || layer === "branch") {
        const base = (await git(["merge-base", "HEAD", ref(r.base)])).trim();
        return atRoot(["diff", ...format, base, ...(layer === "branch" ? ["HEAD"] : []), "--", file]);
      }
      const entry = (await status()).find(f => f.path === file);
      if (entry?.untracked) {
        const info = await lstat(path.join(root, file));
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Preview supports regular text files up to 1 MiB");
        const result = await call("git", [...READ, "diff", ...format, "--no-index", "--", "/dev/null", file], { cwd: root, allowFailure: true });
        if (result.code > 1) throw new Error(result.stderr);
        return result.stdout;
      }
      return atRoot(["diff", ...format, ...(layer === "staged" ? ["--cached"] : layer === "all" && head ? ["HEAD"] : []), "--", file]);
    };

    if (r.action === "status") {
      const [files, index, upstream, branchesRaw, remotesRaw] = await Promise.all([
        status(), indexHash(), maybe(["rev-parse", "--abbrev-ref", "@{upstream}"]),
        git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]), git(["remote"]),
      ]);
      const upstreamOid = upstream ? await maybe(["rev-parse", "@{upstream}"]) : "";
      const counts = upstream && head ? (await maybe(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])).split(/\s+/).map(Number) : [0, 0];
      const defaultBase = await maybe(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      const branches = branchesRaw.trim().split("\n").filter(Boolean);
      const base = r.base || defaultBase || branches.find(b => b === "origin/main") || branches.find(b => b === "main") || branches.find(b => b === "master") || "";
      const stagedStats = parseStats(await atRoot(["diff", "--cached", "--numstat", "-z", ...DIFF]));
      const unstagedStats = parseStats(await atRoot(["diff", "--numstat", "-z", ...DIFF]));
      let comparison = [], branchStats = [], comparisonError = null;
      if (base && head) {
        try {
          const fork = (await git(["merge-base", "HEAD", ref(base)])).trim();
          comparison = parseStats(await atRoot(["diff", "--numstat", "-z", ...DIFF, fork]));
          branchStats = parseStats(await atRoot(["diff", "--numstat", "-z", ...DIFF, fork, "HEAD"]));
        } catch (e) { comparisonError = e.message; }
      }
      const operations = [];
      for (const [file, operation] of [["MERGE_HEAD", "merge"], ["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"]]) {
        const location = (await git(["rev-parse", "--git-path", file])).trim();
        if (await lstat(path.resolve(cwd, location)).catch(() => null)) operations.push(operation);
      }
      return { root, head, branch, index, files, upstream, upstreamOid, notesKey: digest(root), stateKey: digest(JSON.stringify([root, cwd, r.scope || ""])), ahead: counts[0] || 0, behind: counts[1] || 0,
        branches, remotes: remotesRaw.trim().split("\n").filter(Boolean), base, stagedStats, unstagedStats, comparison, branchStats, comparisonError,
        operations: [...new Set(operations)], refreshedAt: new Date().toISOString() };
    }
    if (r.action === "diff") {
      const patch = await patchFor();
      return { patch, hash: digest(patch), fullContext: Boolean(r.fullContext), ...splitPatch(patch) };
    }
    if (r.action === "images") {
      assertHead();
      if (r.index !== await indexHash()) throw new Error("Staging area changed. Reload the image comparison.");
      const file = filePath(), initialPatch = await patchFor(file, r.layer, true);
      const blob = async revision => {
        if (!revision) return null;
        const hash = await maybe(["rev-parse", "--verify", `${revision === ":" ? "" : revision}:${file}`]);
        if (!/^[a-f0-9]{40,64}$/.test(hash)) return null;
        const size = Number((await git(["cat-file", "-s", hash])).trim());
        if (size > 6 * 1024 * 1024) throw new Error("Image exceeds the 6 MiB preview limit");
        return (await call("git", [...READ, "cat-file", "blob", hash], { cwd: root, binary: true })).stdout;
      };
      const working = async () => {
        const location = path.join(root, file);
        const info = await lstat(location).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
        if (!info) return null;
        if (!info.isFile() || await realpath(location) !== location) throw new Error("Image preview requires a regular file inside this repository");
        const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.size > 6 * 1024 * 1024) throw new Error("Image exceeds the regular-file 6 MiB preview limit");
          return await handle.readFile();
        } finally { await handle.close(); }
      };
      let before, after;
      if (r.layer === "staged") { before = await blob(head); after = await blob(":"); }
      else if (r.layer === "unstaged") { before = await blob(":"); after = await working(); }
      else if (r.layer === "branch" || r.layer === "base") {
        const base = (await git(["merge-base", "HEAD", ref(r.base)])).trim();
        before = await blob(base); after = r.layer === "branch" ? await blob(head) : await working();
      } else if (r.layer === "commit") {
        const commit = oid(r.commit), parent = await maybe(["rev-parse", "--verify", `${commit}^`]);
        before = await blob(parent); after = await blob(commit);
      } else throw new Error("Choose a diff layer for image comparison");
      if (initialPatch !== await patchFor(file, r.layer, true)) throw new Error("Image changed while loading. Reload the comparison.");
      return { before: await cacheImage(before, imageDirectory), after: await cacheImage(after, imageDirectory), hash: digest(initialPatch) };
    }
    if (["conflict", "saveConflict"].includes(r.action)) {
      assertHead();
      const file = filePath(), location = path.join(root, file);
      const entry = (await status()).find(item => item.path === file);
      const placeholder = (kind, guidance) => {
        if (r.action !== "conflict") throw new Error(guidance);
        return { kind, guidance, status: entry?.xy, unresolved: Boolean(entry?.conflict) };
      };
      const fileInfo = await lstat(location).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
      if (!fileInfo) return placeholder("deleted", "No working-tree file is available. Resolve the deletion in Git or restore one side, then reload.");
      if (!fileInfo.isFile()) return placeholder("unsupported", "Resolve this symbolic link or special-file conflict in Git, then reload.");
      if (fileInfo.size > 1024 * 1024) return placeholder("large", "This file exceeds the 1 MiB editor limit. Resolve it in your editor, then reload and stage it.");
      const resolved = await realpath(location);
      if (!resolved.startsWith(root + path.sep) || resolved !== location) throw new Error("Conflict editing requires a regular file inside this repository");
      const handle = await open(location, (r.action === "saveConflict" ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Conflict editor supports text files up to 1 MiB");
        const bytes = await handle.readFile(), content = bytes.toString("utf8");
        if (bytes.includes(0) || !Buffer.from(content).equals(bytes)) return placeholder("binary", "This is a binary conflict. Choose the version to keep in Git or a binary editor, then reload.");
        const stages = await atRoot(["ls-files", "--stage", "-z", "--", file]);
        const hash = digest(stages + "\0" + content);
        if (r.action === "conflict") return { content, hash, status: entry?.xy, unresolved: Boolean(entry?.conflict) };
        if (!r.confirm || r.hash !== hash) throw new Error("File or conflict stages changed. Reload before saving.");
        if (typeof r.content !== "string" || Buffer.byteLength(r.content) > 1024 * 1024 || r.content.includes("\0")) throw new Error("Invalid resolved text");
        if (r.stage && /^(?:<{7,}|={7,}|>{7,}|\|{7,})(?:\s|$)/m.test(r.content)) throw new Error("Resolve all conflict markers before staging");
        const next = Buffer.from(r.content);
        let written = 0;
        while (written < next.length) written += (await handle.write(next, written, next.length - written, written)).bytesWritten;
        await handle.truncate(next.length);
        if (r.stage) {
          try { await atRoot(["add", "--", file]); }
          catch (error) { throw new Error(`File saved, but staging failed: ${error.message}`); }
        }
        return r.stage ? "Resolution saved and staged" : "Conflict draft saved";
      } finally { await handle.close(); }
    }
    if (["discardPreview", "discardMany"].includes(r.action)) {
      assertHead();
      const paths = r.action === "discardPreview" ? r.paths : r.files?.map(file => file.path);
      if (!Array.isArray(paths) || !paths.length || paths.length > 2000) throw new Error("Select files to discard");
      const entries = await status(), files = [], index = await indexHash();
      for (const input of [...new Set(paths)]) {
        const file = filePath(input), entry = entries.find(item => item.path === file);
        if (!entry?.unstaged || entry.conflict) throw new Error(`Cannot discard ${file}; refresh or resolve its conflicts`);
        files.push({ path: file, hash: digest(await patchFor(file, "unstaged", true)), untracked: entry.untracked });
      }
      if (r.action === "discardPreview") return { files, index, head };
      if (!r.confirm || r.index !== index || files.some(file => file.hash !== r.files.find(item => item.path === file.path)?.hash)) throw new Error("Selected files or staging area changed. Review them again before discarding.");
      const tracked = files.filter(file => !file.untracked), untracked = files.filter(file => file.untracked);
      let discarded = 0;
      try {
        if (tracked.length) { await atRoot(["restore", "--worktree", "--", ...tracked.map(file => file.path)]); discarded += tracked.length; }
        for (const file of untracked) { await unlink(path.join(root, file.path)); discarded++; }
      } catch (error) { throw new Error(`${discarded} files discarded before an error: ${error.message}. Refresh before retrying.`); }
      return `Discarded changes in ${discarded} files`;
    }
    if (r.action === "history") {
      const limit = Math.max(100, Math.min(2000, Number(r.limit) || 100));
      const raw = await git(["log", "--all", "--topo-order", "--date=iso-strict", "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00", "-n", String(Math.floor(limit)),
        ...(r.query ? ["--fixed-strings", "--regexp-ignore-case", "--grep", required(r.query, "Search text")] : [])]);
      const parts = raw.split("\0"), commits = [];
      for (let n = 0; n + 5 < parts.length; n += 6) commits.push({ hash: parts[n].trim(), parents: parts[n + 1].split(" ").filter(Boolean), subject: parts[n + 2], author: parts[n + 3], date: parts[n + 4], refs: parts[n + 5] });
      return commits;
    }
    if (r.action === "commitFiles") return parseStats(await git(["diff-tree", "--root", "--no-commit-id", "-r", "--numstat", "-z", ...DIFF, oid(r.commit)]));
    if (r.action === "commitMessage") return git(["show", "-s", "--format=%B", oid(r.commit)]);
    if (r.action === "template") {
      const template = await maybe(["config", "--get", "commit.template"]);
      if (!template) return "";
      return readFile(path.resolve(cwd, template), "utf8");
    }
    if (r.action === "generate") {
      assertHead();
      if (r.index !== await indexHash()) throw new Error("Staging area changed. Refresh before generating.");
      const purpose = r.purpose;
      let patch, subjects = "";
      if (purpose === "commit") patch = await atRoot(["diff", "--cached", ...DIFF]);
      else if (purpose === "pr") {
        const requested = ref(r.base);
        const baseRef = await maybe(["rev-parse", "--verify", `${requested}^{commit}`]) ? requested : `origin/${requested}`;
        const base = (await git(["merge-base", "HEAD", baseRef])).trim();
        patch = await atRoot(["diff", ...DIFF, base, "HEAD"]);
        subjects = await git(["log", "--format=%s", `${base}..HEAD`]);
      } else throw new Error("Choose commit or PR generation");
      if (!patch.trim()) throw new Error("No changes to summarize");
      if (patch.length > 180000) throw new Error("Diff is too large to send at once. Stage a smaller change or write the summary manually.");
      return generateText({ provider: r.provider, model: r.model, effort: r.effort, instruction: r.instruction, cancelFile: r.cancelFile, purpose, patch, subjects }, runner);
    }
    const localActions = ["stage", "unstage", "hunk", "discard", "commit", "fetch", "pull", "push", "sync", "rebase", "switch", "branch", "checkoutCommit", "branchFromCommit", "cherry-pick", "revert", "abort", "continue"];
    if (localActions.includes(r.action)) {
      assertHead();
      if (["stage", "unstage", "hunk", "discard", "commit"].includes(r.action) && r.index !== await indexHash()) throw new Error("Staging area changed. Refresh and review before retrying.");
      switch (r.action) {
        case "stage": case "unstage": {
          if (r.paths !== undefined && (!Array.isArray(r.paths) || !r.paths.length || r.paths.length > 2000)) throw new Error("Select files first");
          const paths = r.paths ? [...new Set(r.paths.map(filePath))] : r.path ? [filePath()] : ["."];
          const entries = await status();
          if (r.paths && paths.some(file => !entries.some(entry => entry.path === file && (r.action === "stage" ? entry.unstaged : entry.staged)))) throw new Error("Selection changed. Refresh before retrying.");
          if (r.action === "stage") {
            if (entries.some(file => file.conflict && (paths.includes(".") || paths.includes(file.path)))) throw new Error("Resolve conflicting files in the conflict editor before staging");
            return atRoot(["add", "-A", "--", ...paths]);
          }
          return atRoot(head ? ["restore", "--staged", "--", ...paths] : ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths]);
        }
        case "hunk": {
          if (!["staged", "unstaged"].includes(r.layer)) throw new Error("Choose staged or unstaged changes first");
          const entry = (await status()).find(f => f.path === filePath());
          if (!entry || entry.untracked || entry.conflict) throw new Error("Stage this file as a whole");
          const patch = await patchFor(), parsed = splitPatch(patch);
          if (digest(patch) !== r.hash) throw new Error("Diff changed. Reload it before staging.");
          if (!Number.isInteger(r.hunk) || !parsed.hunks[r.hunk]) throw new Error("Hunk no longer exists");
          const hunk = r.lines ? selectHunkLines(parsed.hunks[r.hunk], r.lines, r.layer === "staged") : parsed.hunks[r.hunk];
          const input = parsed.header + hunk;
          const args = ["apply", "--cached", "--recount", ...(r.layer === "staged" ? ["--reverse"] : [])];
          await atRoot([...args, "--check", "-"], { input });
          return atRoot([...args, "-"], { input });
        }
        case "discard": {
          if (r.confirm !== true) throw new Error("Discard requires confirmation");
          const entry = (await status()).find(f => f.path === filePath());
          if (!entry || entry.conflict) throw new Error("Resolve conflicting files in an editor");
          const patch = await patchFor(filePath(), r.layer, Boolean(r.binary));
          if (r.hash !== digest(patch)) throw new Error("File changed since preview. Review it again.");
          if (entry.untracked) { await unlink(path.join(root, filePath())); return "Removed untracked file"; }
          return atRoot(["restore", "--worktree", "--", filePath()]);
        }
        case "commit": {
          const message = required(r.message, "Commit message");
          if (r.amend && !r.confirm) throw new Error("Amend requires confirmation");
          if ((await status()).some(f => f.conflict)) throw new Error("Resolve conflicts before committing");
          if (r.after && !["push", "sync"].includes(r.after)) throw new Error("Invalid post-commit action");
          const output = await git(["commit", ...(r.amend ? ["--amend"] : []), "-F", "-"], { input: message });
          if (!r.after) return output;
          try {
            if (r.after === "sync") await git(["pull", "--rebase"]);
            return output + await git(["push", "--set-upstream", ref(await maybe(["config", `branch.${branch}.remote`]) || "origin"), `HEAD:${await maybe(["config", `branch.${branch}.merge`]) || `refs/heads/${branch}`}`]);
          } catch (error) { throw new Error(`Commit created successfully, but ${r.after} failed.\n${error.message}`); }
        }
        case "fetch": return git(["fetch", "--prune", ref(r.remote || "origin")]);
        case "pull": return git(["pull", "--ff-only"]);
        case "rebase":
          if (!r.confirm) throw new Error("Rebase requires confirmation");
          return git(["rebase", ref(r.base)]);
        case "sync":
          if (!r.confirm) throw new Error("Sync requires confirmation");
          if ((await status()).length) throw new Error("Commit or stash changes before syncing");
          await git(["pull", "--rebase"]);
          return git(["push"]);
        case "push": {
          if (!branch) throw new Error("Create or switch to a branch before pushing");
          const remote = r.remote || await maybe(["config", `branch.${branch}.remote`]) || "origin";
          const destination = await maybe(["config", `branch.${branch}.merge`]) || `refs/heads/${branch}`;
          if (!destination.startsWith("refs/heads/") || remote === ".") throw new Error("Choose a remote branch before pushing");
          const args = ["push", "--set-upstream"];
          if (r.force) {
            if (!r.confirm || !r.upstreamOid) throw new Error("Force push needs a reviewed upstream commit and confirmation");
            args.push(`--force-with-lease=${destination}:${oid(r.upstreamOid)}`);
          }
          return git([...args, ref(remote), `HEAD:${destination}`]);
        }
        case "switch": return git(["switch", ref(r.branch)]);
        case "branch": return git(["switch", "-c", ref(r.branch)]);
        case "checkoutCommit": case "branchFromCommit":
          if (!r.confirm) throw new Error("Confirm the commit checkout first");
          if ((await status()).length) throw new Error("Commit or stash your changes before checking out this commit");
          return git(["switch", ...(r.action === "checkoutCommit" ? ["--detach"] : ["-c", ref(r.branch)]), oid(r.commit)]);
        case "cherry-pick": case "revert":
          if (!r.confirm) throw new Error("Confirm the commit operation first");
          return git([r.action, ...(r.action === "revert" ? ["--no-edit"] : []), oid(r.commit)]);
        case "abort": case "continue": {
          if (!["merge", "rebase", "cherry-pick", "revert"].includes(r.operation) || !r.confirm) throw new Error("Confirm the Git operation first");
          return git(["-c", "core.editor=true", r.operation, `--${r.action}`]);
        }
      }
    }

    const gh = async (args, options) => (await call("gh", args, options)).stdout;
    const json = async args => JSON.parse(await gh(args));
    const repository = await json(["repo", "view", ...(r.githubRepository ? [r.githubRepository] : []), "--json", "nameWithOwner,url,defaultBranchRef,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"]);
    const repo = repository.nameWithOwner, hostname = new URL(repository.url).hostname;
    const api = async (endpoint, method = "GET", payload) => {
      const args = ["api", "--hostname", hostname, endpoint, "--method", method];
      if (endpoint.includes("/stacks") || endpoint.includes("/merge-async")) args.push("--header", "X-GitHub-Api-Version: 2026-03-10");
      if (payload) args.push("--input", "-");
      const output = await gh(args, { input: payload ? JSON.stringify(payload) : undefined });
      return output.trim() ? JSON.parse(output) : null;
    };
    const graphql = async (query, variables) => {
      const reply = await api("graphql", "POST", { query, variables });
      if (reply.errors?.length) throw new Error(reply.errors.map(e => e.message).join("\n"));
      return reply.data;
    };
    const [owner, name] = repo.split("/");
    const apiPath = `repos/${repo}`;
    const paginate = async endpoint => {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const items = await api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
        all.push(...items);
        if (items.length < 100) return all;
      }
      throw new Error("More than 2,000 results. Open the full list on GitHub.");
    };
    const fields = "id,number,url,title,body,state,isDraft,headRefName,headRefOid,baseRefName,author,additions,deletions,changedFiles,reviewDecision,reviewRequests,mergeable,mergeStateStatus,autoMergeRequest,statusCheckRollup,comments,reviews,labels,assignees";
    const pr = async number => json(["pr", "view", ...(number ? [id(number)] : branch ? [branch] : []), "--repo", repository.url, "--json", fields]);
    const stackFor = async number => {
      let stacks;
      try { stacks = await api(`${apiPath}/stacks?pull_request=${id(number)}`); }
      catch (error) { if (/HTTP 404/.test(error.message)) return null; throw error; }
      if (!Array.isArray(stacks)) throw new Error("Could not read registered PR stacks");
      const stack = stacks.find(stack => stack.pull_requests?.some(item => item.number === Number(number)));
      if (!stack) return null;
      const position = stack.pull_requests.findIndex(item => item.number === Number(number));
      const scope = stack.pull_requests.slice(0, position + 1).filter(item => item.state === "open");
      return { ...stack, position: position + 1, scope, hash: digest(JSON.stringify([stack.number, stack.base.ref, stack.pull_requests.map(item => [item.number, item.head.sha, item.state])])) };
    };
    const queueFor = async number => {
      const data = await graphql(`query($owner:String!,$name:String!,$number:Int!) {
        repository(owner:$owner,name:$name) { pullRequest(number:$number) {
          headRefOid isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position state enqueuedAt estimatedTimeToMerge }
        } }
      }`, { owner, name, number: Number(number) });
      return data.repository.pullRequest;
    };
    if (r.action === "github") {
      let pull = null;
      if (r.number) pull = await pr(r.number);
      else if (branch) {
        const candidates = await json(["pr", "list", "--repo", repository.url, "--head", branch, "--state", "all", "--limit", "10", "--json", "number,state,headRefOid"]);
        const selected = candidates.find(p => p.state === "OPEN") || candidates.find(p => p.headRefOid === head);
        if (selected) pull = await pr(selected.number);
      }
      const mergeContext = { stack: null, queue: null, error: "" };
      if (pull) {
        const result = await Promise.allSettled([stackFor(pull.number), queueFor(pull.number)]);
        for (const [index, item] of result.entries()) {
          if (item.status === "fulfilled") mergeContext[index ? "queue" : "stack"] = item.value;
          else mergeContext.error += `${item.reason.message}\n`;
        }
        if (mergeContext.queue && mergeContext.queue.headRefOid !== pull.headRefOid) { mergeContext.queue = null; mergeContext.error += "PR head changed while loading merge details. Refresh.\n"; }
      }
      return { repository, pr: pull, mergeContext, refreshedAt: new Date().toISOString() };
    }
    if (r.action === "mergeResult") {
      if (!/^[a-f0-9-]{36}$/i.test(r.uuid || "")) throw new Error("Invalid merge request ID");
      return api(`${apiPath}/pulls/${id(r.number)}/merge-async/${r.uuid}`);
    }
    if (r.action === "runs") return json(["run", "list", "--repo", repository.url, ...(r.sha ? ["--commit", oid(r.sha)] : ["--branch", branch]), "--limit", "30", "--json", "databaseId,name,displayTitle,status,conclusion,event,headSha,url,createdAt,updatedAt"]);
    if (r.action === "jobs") return json(["run", "view", id(r.runId), "--repo", repository.url, "--json", "jobs"]);
    if (r.action === "log") return gh(["run", "view", id(r.runId), "--repo", repository.url, ...(r.jobId ? ["--job", id(r.jobId)] : []), "--log"]);
    if (r.action === "checkDetails") {
      const sha = oid(r.sha), checkName = required(r.name, "Check name");
      const response = await api(`${apiPath}/commits/${sha}/check-runs?per_page=100&check_name=${encodeURIComponent(checkName)}`);
      const runs = response.check_runs || [];
      const check = runs.find(c => c.details_url === r.url) || (runs.length === 1 ? runs[0] : null);
      if (!check) throw new Error("No unambiguous check details found. Open the check on GitHub.");
      const annotations = await paginate(`${apiPath}/check-runs/${id(check.id)}/annotations`);
      let job = null;
      if (check.details_url) {
        const url = new URL(check.details_url), prefix = `/${repo}/actions/runs/`;
        const match = url.pathname.startsWith(prefix) && /\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(url.pathname);
        if (url.hostname === hostname && match) {
          job = await api(`${apiPath}/actions/jobs/${id(match[2])}`);
          if (job.head_sha !== sha) throw new Error("Check job changed. Refresh before opening details.");
        }
      }
      return { check, annotations, job };
    }
    if (r.action === "threads") {
      const comments = await paginate(`${apiPath}/pulls/${id(r.number)}/comments`);
      const metadata = new Map(); let cursor = null;
      do {
        const data = await graphql(`query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
          repository(owner:$owner,name:$name) { pullRequest(number:$number) {
            reviewThreads(first:100,after:$cursor) { pageInfo { hasNextPage endCursor }
              nodes { id isResolved isOutdated viewerCanResolve viewerCanUnresolve comments(first:1) { nodes { databaseId } } }
            }
          } }
        }`, { owner, name, number: Number(id(r.number)), cursor });
        const page = data.repository.pullRequest.reviewThreads;
        for (const thread of page.nodes) metadata.set(thread.comments.nodes[0]?.databaseId, thread);
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return comments.map(comment => {
        const thread = metadata.get(comment.in_reply_to_id || comment.id);
        return { ...comment, threadId: thread?.id, isResolved: thread?.isResolved, isOutdated: thread?.isOutdated,
          canResolve: thread?.viewerCanResolve, canUnresolve: thread?.viewerCanUnresolve };
      });
    }
    if (r.action === "viewedFiles") {
      const files = {}; let cursor = null;
      do {
        const data = await graphql(`query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
          repository(owner:$owner,name:$name) { pullRequest(number:$number) {
            files(first:100,after:$cursor) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
          } }
        }`, { owner, name, number: Number(id(r.number)), cursor });
        const page = data.repository.pullRequest.files;
        for (const file of page.nodes) files[file.path] = file.viewerViewedState;
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return files;
    }
    if (r.action === "conversation") return paginate(`${apiPath}/issues/${id(r.number)}/comments`);
    if (r.action === "metadata") {
      if (!["labels", "assignees", "reviewers"].includes(r.field)) throw new Error("Unknown PR field");
      return paginate(`${apiPath}/${r.field === "labels" ? "labels" : "assignees"}`);
    }
    if (r.action === "prImages") {
      const number = id(r.number), file = filePath();
      const [pull, files] = await Promise.all([api(`${apiPath}/pulls/${number}`), paginate(`${apiPath}/pulls/${number}/files`)]);
      if (r.prHead !== pull.head.sha) throw new Error("PR head changed. Refresh before previewing images.");
      const change = files.find(item => item.filename === file);
      if (!change) throw new Error("This image is not in the pull request diff");
      const repositoryName = value => {
        if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(value || "") || value.split("/").some(part => [".", ".."].includes(part))) throw new Error("Invalid image repository");
        return value;
      };
      const headRepo = repositoryName(pull.head.repo?.full_name || repo);
      const head = oid(pull.head.sha), base = oid(pull.base.sha);
      const comparison = await api(`${apiPath}/compare/${base}...${encodeURIComponent(headRepo.split("/")[0])}:${head}?per_page=1`);
      const mergeBase = oid(comparison.merge_base_commit.sha);
      const version = async (sourceRepo, revision, filename) => {
        const encoded = filePath(filename).split("/").map(encodeURIComponent).join("/");
        let item = await api(`repos/${sourceRepo}/contents/${encoded}?ref=${revision}`);
        if (item.type !== "file" || item.size > 4 * 1024 * 1024) throw new Error("Remote image preview supports regular files up to 4 MiB");
        if (item.encoding !== "base64") item = await api(`repos/${sourceRepo}/git/blobs/${oid(item.sha)}`);
        if (item.encoding !== "base64" || typeof item.content !== "string") throw new Error("GitHub did not return image content");
        const bytes = Buffer.from(item.content, "base64");
        if (bytes.length > 4 * 1024 * 1024) throw new Error("Remote image exceeds the 4 MiB preview limit");
        return cacheImage(bytes, imageDirectory);
      };
      const [before, after] = await Promise.all([
        change.status === "added" ? null : version(repo, mergeBase, change.previous_filename || file),
        change.status === "removed" ? null : version(headRepo, head, file),
      ]);
      return { before, after, head, mergeBase };
    }
    if (r.action === "prFiles") return api(`${apiPath}/pulls/${id(r.number)}/files?per_page=100&page=${Math.max(1, Number(r.page) || 1)}`);
    if (r.action === "prList") return json(["pr", "list", "--repo", repository.url, "--state", "open", "--limit", "50", "--json", "number,title,headRefName,isDraft,url"]);
    if (r.action === "prDraft") {
      const base = ref(r.base || repository.defaultBranchRef?.name || "main");
      const baseRef = (await maybe(["rev-parse", "--verify", `${base}^{commit}`])) ? base : `origin/${base}`;
      const commits = await git(["log", "--format=%s", `${baseRef}..HEAD`]);
      return { title: commits.trim().split("\n")[0] || branch, body: `## Summary\n\n${commits.trim().split("\n").filter(Boolean).map(s => `- ${s}`).join("\n")}\n\n## Validation\n\n`, base };
    }
    if (r.action === "stackDetails") {
      const stack = await stackFor(r.number);
      if (!stack) return null;
      const fields = stack.pull_requests.map((item, i) => `item${i}:pullRequest(number:${id(item.number)}) {
        title state isDraft mergedAt headRefOid reviewDecision commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
      }`).join("\n");
      const data = await graphql(`query($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { ${fields} } }`, { owner, name });
      stack.pull_requests = stack.pull_requests.map((item, i) => {
        const value = data.repository[`item${i}`];
        if (!value || value.headRefOid !== item.head.sha) throw new Error("Stack changed while loading. Refresh its details.");
        if (item.number === Number(r.number) && value.headRefOid !== r.prHead) throw new Error("PR head changed. Refresh its details.");
        return { ...item, title: value.title, state: value.state.toLowerCase(), draft: value.isDraft, merged_at: value.mergedAt,
          reviewDecision: value.reviewDecision, checkState: value.commits.nodes[0]?.commit.statusCheckRollup?.state };
      });
      return stack;
    }
    if (r.action === "stackParent") {
      const base = ref(r.base);
      if (base === repository.defaultBranchRef?.name) return null;
      const candidates = await json(["pr", "list", "--repo", repository.url, "--head", base, "--state", "open", "--limit", "20", "--json", "number"]);
      const matches = [];
      for (const item of candidates) {
        const pull = await api(`${apiPath}/pulls/${id(item.number)}`);
        if (pull.head.ref === base && pull.head.repo?.full_name.toLowerCase() === repo.toLowerCase()) matches.push(pull);
      }
      if (!matches.length) return null;
      if (matches.length !== 1) throw new Error("Multiple open PRs use this base branch. Choose another base.");
      const parent = matches[0], stack = await stackFor(parent.number);
      return { number: parent.number, title: parent.title, head: parent.head.sha, base, stackHash: stack?.hash || null, stackNumber: stack?.number || null };
    }
    if (r.action === "createPR") {
      assertHead();
      const base = ref(required(r.base, "Base branch"));
      required(r.title, "Title"); text(r.body, "Description");
      if (!branch || branch === base) throw new Error("Choose a feature branch distinct from the base");
      const validateParent = async () => {
        const parent = await api(`${apiPath}/pulls/${id(r.parent.number)}`), stack = await stackFor(r.parent.number);
        if (parent.state !== "open" || parent.head.sha !== r.parent.head || parent.head.ref !== base || parent.head.repo?.full_name.toLowerCase() !== repo.toLowerCase()) throw new Error("Parent PR changed. Review the base branch again.");
        if ((stack?.hash || null) !== (r.parent.stackHash || null)) throw new Error("Parent stack changed. Review it again.");
        if (stack && stack.scope.at(-1)?.number !== stack.pull_requests.filter(item => item.state === "open").at(-1)?.number) throw new Error("Choose the top open PR of the stack as the base");
        return stack;
      };
      if (r.parent) {
        if (!r.confirm) throw new Error("Confirm stacked PR creation first");
        if (r.headBranch?.includes(":")) throw new Error("Registered stacks require branches in the same repository");
        await validateParent();
      }
      if (r.push) {
        await git(["push", "--set-upstream", ref(r.remote || "origin"), `HEAD:refs/heads/${branch}`]);
      }
      const url = await gh(["pr", "create", "--repo", repository.url, "--head", ref(r.headBranch || branch), "--base", base, "--title", r.title, "--body-file", "-", ...(r.draft ? ["--draft"] : [])], { input: r.body });
      if (r.parent) {
        try {
          const created = new URL(url.trim()), prefix = `/${repo}/pull/`;
          if (created.hostname !== hostname || !created.pathname.startsWith(prefix)) throw new Error("Could not identify the new pull request");
          const number = Number(id(created.pathname.slice(prefix.length))), stack = await validateParent();
          if (stack) await api(`${apiPath}/stacks/${id(stack.number)}/add`, "POST", { pull_requests: [number] });
          else await api(`${apiPath}/stacks`, "POST", { pull_requests: [Number(id(r.parent.number)), number] });
        } catch (error) { return `PR created: ${url.trim()}\nStack registration failed: ${error.message}. The PR remains open; do not create it again.`; }
      }
      return url.trim();
    }
    if (["rerun", "cancelRun"].includes(r.action)) {
      if (!r.confirm) throw new Error("Confirm the workflow operation first");
      return gh(["run", r.action === "rerun" ? "rerun" : "cancel", id(r.runId), "--repo", repository.url, ...(r.failedOnly ? ["--failed"] : [])]);
    }
    const pull = await pr(r.number);
    if (r.prHead !== pull.headRefOid) throw new Error("PR head changed. Refresh and review before retrying.");
    const number = id(pull.number);
    if (r.action === "updateMetadata") {
      const value = required(r.value, "Field value");
      if (typeof r.add !== "boolean") throw new Error("Specify whether to add or remove the value");
      if ([".", ".."].includes(value)) throw new Error("Invalid field value");
      if (r.field === "labels") return r.add
        ? api(`${apiPath}/issues/${number}/labels`, "POST", { labels: [value] })
        : api(`${apiPath}/issues/${number}/labels/${encodeURIComponent(value)}`, "DELETE");
      if (!["assignees", "reviewers"].includes(r.field)) throw new Error("Unknown PR field");
      if (!/^[a-z\d-]+(?:\/[a-z\d-]+)?$/i.test(value) || (r.field === "assignees" && value.includes("/"))) throw new Error("Enter a GitHub login or an organization/team reviewer");
      if (value.includes("/") && value.split("/")[0].toLowerCase() !== owner.toLowerCase()) throw new Error("Reviewer teams must belong to the repository organization");
      if (r.field === "reviewers" && value.toLowerCase() === pull.author?.login?.toLowerCase()) throw new Error("The author cannot review their own pull request");
      const field = r.field === "reviewers" && value.includes("/") ? "team_reviewers" : r.field;
      const endpoint = r.field === "reviewers" ? `pulls/${number}/requested_reviewers` : `issues/${number}/assignees`;
      return api(`${apiPath}/${endpoint}`, r.add ? "POST" : "DELETE", { [field]: [value.split("/").at(-1)] });
    }
    if (r.action === "resolveThread") {
      const threadId = required(r.threadId, "Review thread");
      const data = await graphql(`query($id:ID!) { node(id:$id) { ... on PullRequestReviewThread {
        viewerCanResolve viewerCanUnresolve pullRequest { number repository { nameWithOwner } }
      } } }`, { id: threadId });
      const thread = data.node;
      if (thread?.pullRequest.number !== pull.number || thread.pullRequest.repository.nameWithOwner !== repo) throw new Error("Review thread does not belong to this pull request");
      if (!(r.resolved ? thread.viewerCanResolve : thread.viewerCanUnresolve)) throw new Error("You cannot change this thread's resolved state");
      const mutation = r.resolved ? "resolveReviewThread" : "unresolveReviewThread";
      return graphql(`mutation($id:ID!) { ${mutation}(input:{threadId:$id}) { thread { id isResolved } } }`, { id: threadId });
    }
    if (r.action === "viewFile") {
      const mutation = r.viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
      return graphql(`mutation($id:ID!,$path:String!) { ${mutation}(input:{pullRequestId:$id,path:$path}) { clientMutationId } }`, { id: pull.id, path: filePath() });
    }
    if (r.action === "reaction") {
      if (!["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"].includes(r.content)) throw new Error("Unknown reaction");
      const family = r.reviewComment ? "pulls/comments" : "issues/comments";
      const endpoint = `${apiPath}/${family}/${id(r.commentId)}/reactions`;
      const user = await api("user"), reactions = await paginate(endpoint);
      const existing = reactions.find(reaction => reaction.content === r.content && reaction.user?.login === user.login);
      return existing ? api(`${endpoint}/${id(existing.id)}`, "DELETE") : api(endpoint, "POST", { content: r.content });
    }
    if (r.action === "comment") return gh(["pr", "comment", number, "--repo", repository.url, "--body-file", "-"], { input: required(r.body, "Comment") });
    if (r.action === "reply") return api(`${apiPath}/pulls/${number}/comments/${id(r.commentId)}/replies`, "POST", { body: required(r.body, "Reply") });
    if (r.action === "review") {
      if (!["approve", "request-changes", "comment"].includes(r.verdict) || !r.confirm) throw new Error("Confirm review before submitting");
      return api(`${apiPath}/pulls/${number}/reviews`, "POST", { commit_id: pull.headRefOid, event: { approve: "APPROVE", "request-changes": "REQUEST_CHANGES", comment: "COMMENT" }[r.verdict], body: r.verdict === "approve" ? text(r.body, "Review") : required(r.body, "Review") });
    }
    if (r.action === "inlineComment") return api(`${apiPath}/pulls/${number}/comments`, "POST", { body: required(r.body, "Comment"), commit_id: pull.headRefOid, path: filePath(), line: Number(id(r.line)), side: r.side === "LEFT" ? "LEFT" : "RIGHT" });
    if (r.action === "editPR") return gh(["pr", "edit", number, "--repo", repository.url, "--title", required(r.title, "Title"), "--base", ref(r.base), "--body-file", "-"], { input: text(r.body, "Description") });
    if (["closePR", "reopenPR", "readyPR"].includes(r.action)) {
      if (!r.confirm) throw new Error("Confirm the PR state change first");
      return gh(["pr", { closePR: "close", reopenPR: "reopen", readyPR: "ready" }[r.action], number, "--repo", repository.url]);
    }
    if (r.action === "dequeue") {
      if (!r.confirm) throw new Error("Confirm removal from the merge queue first");
      const stack = await stackFor(pull.number);
      if (stack && r.stackHash !== stack.hash) throw new Error("PR stack changed. Refresh and review the affected pull requests.");
      await graphql(`mutation($id:ID!) { dequeuePullRequest(input:{pullRequestId:$id}) { clientMutationId } }`, { id: pull.id });
      return "Removed from merge queue";
    }
    if (["mergeStack", "enqueue"].includes(r.action)) {
      if (!r.confirm) throw new Error("Confirm the merge scope first");
      if (pull.state !== "OPEN" || pull.isDraft || pull.mergeable === "CONFLICTING") throw new Error("PR is closed, draft, or conflicting");
      const stack = await stackFor(pull.number);
      if ((stack?.hash || null) !== (r.stackHash || null)) throw new Error("PR stack changed. Refresh and review the affected pull requests.");
      if (r.action === "mergeStack" && !stack) throw new Error("This pull request is no longer in the reviewed stack");
      if (r.action === "mergeStack" && (!["merge", "squash", "rebase"].includes(r.method) || !repository[`${r.method === "merge" ? "mergeCommit" : r.method + "Merge"}Allowed`])) throw new Error("Merge method is not allowed by this repository");
      return api(`${apiPath}/pulls/${number}/merge-async`, "PUT", { sha: pull.headRefOid, merge_action: r.action === "enqueue" ? "merge_queue" : "default", ...(r.action === "mergeStack" ? { merge_method: r.method } : {}), bypass_rules: false });
    }
    if (r.action === "merge") {
      if (!r.confirm) throw new Error("Confirm merge first");
      if (pull.state !== "OPEN" || pull.isDraft || pull.mergeable === "CONFLICTING") throw new Error("PR is closed, draft, or conflicting");
      if (!["merge", "squash", "rebase"].includes(r.method) || !repository[`${r.method === "merge" ? "mergeCommit" : r.method + "Merge"}Allowed`]) throw new Error("Merge method is not allowed by this repository");
      if (await stackFor(pull.number)) throw new Error("This PR belongs to a stack. Review its scope and use Merge stack.");
      return gh(["pr", "merge", number, "--repo", repository.url, `--${r.method}`, "--match-head-commit", pull.headRefOid, ...(r.auto ? ["--auto"] : [])]);
    }
    if (r.action === "disableAuto") {
      if (!r.confirm) throw new Error("Confirm disabling auto-merge first");
      return gh(["pr", "merge", number, "--repo", repository.url, "--disable-auto"]);
    }
    throw new Error(`Unknown action: ${r.action}`);
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify({ ok: true, data: await createService()(JSON.parse(process.argv[2])) })); }
  catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error).replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[redacted]") })); process.exitCode = 1; }
}
