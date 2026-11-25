export function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) { const found = findNode(child, predicate); if (found) return found; }
  return null;
}

export function agentPRSignal(output, repositoryUrl) {
  const repository = String(repositoryUrl || "").replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
  if (!/^https?:\/\//.test(repository)) return null;
  const host = repository.match(/^https?:\/\/[^/]+/)[0];
  const text = String(output || "").slice(-24000).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const links = [...text.matchAll(/(https?:\/\/[a-z0-9.:-]+\/[^\s/<>()]+\/[^\s/<>()]+)\/pull\/([1-9]\d*)\b/gi)];
  const match = links.filter(link => link[1].toLowerCase().startsWith(`${host}/`)).at(-1);
  if (match && Number.isSafeInteger(Number(match[2]))) return { key: `${match[1]}/pull/${match[2]}`, number: Number(match[2]), repository: match[1] };
  // Do not send automatic lookups to a different GitHub host.
  if (links.length) return null;
  const affirmative = text.split("\n").filter(line => !/\b(?:not|never|no|haven't|hasn't|didn't|wasn't|couldn't)\b|생성[^\n]*(?:않|실패|예정)/i.test(line)).join("\n");
  const created = [...affirmative.matchAll(/(?:\bcreated\s+(?:(?:a|the)\s+)?(?:draft\s+)?(?:pull request|PR)\b|\b(?:pull request|PR)\s+(?:#\d+\s+)?(?:has been |was )?created\b|(?:PR|풀\s*리퀘스트)[^\n]{0,30}(?:생성\s*(?:했|하였|완료|됐|되었)|올렸|열었))[^\n]*/gi)].at(-1);
  if (!created) return null;
  const number = Number(created[0].match(/#([1-9]\d*)/)?.[1]) || null;
  const pushed = [...affirmative.slice(0, created.index).matchAll(/(?:^|\n)\s*(?:[└│]\s*)?To\s+(https?:\/\/[a-z0-9.:-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+)/gi)].at(-1);
  const target = pushed?.[1].replace(/\.git$/, "") || repository;
  if (!target.toLowerCase().startsWith(`${host}/`) || number !== null && !Number.isSafeInteger(number)) return null;
  return { key: number ? `${target}/pull/${number}` : `${target}:${created[0]}`, number, repository: target };
}

export const githubActions = new Set(["github", "mergeResult", "runs", "jobs", "log", "checkDetails", "threads", "viewedFiles", "conversation", "metadata", "prImages", "prFiles", "prList", "stackDetails", "rerun", "cancelRun", "updateMetadata", "resolveThread", "viewFile", "reaction", "comment", "reply", "review", "inlineComment", "editPR", "dequeue", "enqueue", "mergeStack", "merge", "disableAuto", "readyPR", "closePR", "reopenPR"]);

export function location(focus, allSpaces, allPanes, remembered = {}) {
  const space = allSpaces.find(s => s.active), tab = space?.tabs?.find(t => t.active);
  const scope = `${space?.id || ""}/${tab?.id || ""}`;
  const active = allPanes.find(p => p.pane === focus?.pane && p.cwd);
  const cwd = active?.cwd || focus?.cwd || remembered[scope] || allPanes.find(p => p.tab === tab?.id && p.cwd)?.cwd || space?.folder;
  if (cwd) remembered[scope] = cwd;
  const on = active?.machine || space?.machine || null;
  return { cwd, on, scope, key: JSON.stringify([scope, cwd, on]) };
}

export function makeState(context) {
  return { context, section: "Changes", data: null, github: null, runs: [], history: [], loading: false, ghLoading: false,
    error: "", ghError: "", notice: "", busy: "", query: "", base: "", aiProvider: "codex", aiModel: "", aiEffort: "medium", aiInstructions: "", selected: null, diff: null, diffLoading: false,
    diffRequest: 0, gitRequest: 0, ghRequest: 0, message: "", title: "", body: "", comment: "", headBranch: "",
    draft: true, push: true, amend: false, editPR: false, composing: false, threads: [], prFiles: [], jobs: {}, notes: [], noteBody: "",
    expandedChecks: {}, checkDetails: {}, expandedRuns: {}, collapsed: {}, folders: {}, tree: false, filterOpen: false, prTab: "Conversation", menu: null, fileLimit: 100, confirm: null, number: null, wrap: false, whitespace: false, hunk: 0, selectedCommit: null };
}

export function checkState(check) {
  const state = String(check.conclusion || check.state || check.status || "pending").toLowerCase();
  if (["success", "neutral", "skipped"].includes(state)) return "success";
  if (["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(state)) return "failure";
  return "pending";
}

export function diffRows(patch, whitespace = false) {
  let before = 0, after = 0, hunk = -1;
  return patch.replace(/\n$/, "").split("\n").map((line, index) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { before = +match[1]; after = +match[2]; hunk++; }
    const kind = match ? "hunk" : hunk < 0 ? "meta" : line[0] === "+" ? "add" : line[0] === "-" ? "del" : "context";
    const old = ["del", "context"].includes(kind) && line[0] !== "\\" ? before++ : null;
    const next = ["add", "context"].includes(kind) && line[0] !== "\\" ? after++ : null;
    return { index, hunk, kind, old, next, text: whitespace ? line.replace(/ /g, "·").replace(/\t/g, "→   ") : line.replace(/\t/g, "    ") };
  });
}

export function diffFiles(state) {
  const selected = state.selected;
  if (!selected) return [];
  const data = state.data, layer = selected.layer;
  const files = layer === "commit" ? state.commitFiles || [] : layer === "branch" ? data.branchStats || data.comparison : layer === "base" ? data.comparison : data.files.filter(file => layer === "staged" ? file.staged : file.unstaged);
  const paths = [...new Set([...(files || []).map(file => file.path), selected.path])];
  return paths.map(path => ({ path, layer, ...(selected.commit ? { commit: selected.commit } : {}) }));
}

export function pairedDiffRows(rows) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    if (row.kind !== "add" && row.kind !== "del") { result.push({ left: row, right: row }); i++; continue; }
    const removed = [], added = [];
    while (rows[i]?.kind === "del") removed.push(rows[i++]);
    while (rows[i]?.kind === "add") added.push(rows[i++]);
    for (let j = 0; j < Math.max(removed.length, added.length); j++) result.push({ left: removed[j], right: added[j] });
  }
  return result;
}

export function conflictBlocks(content) {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) || [], blocks = [];
  let offset = 0, block = null;
  for (const [index, line] of lines.entries()) {
    if (/^<{7,}(?:\s|$)/.test(line)) block = { start: offset, line: index + 1, currentStart: offset + line.length };
    else if (block && /^\|{7,}(?:\s|$)/.test(line)) { block.currentEnd = offset; block.baseStart = offset + line.length; }
    else if (block && /^={7,}\s*$/.test(line)) { block.currentEnd ??= offset; block.baseEnd = offset; block.incomingStart = offset + line.length; }
    else if (block?.incomingStart !== undefined && /^>{7,}(?:\s|$)/.test(line)) {
      blocks.push({ ...block, end: offset + line.length, current: content.slice(block.currentStart, block.currentEnd), base: block.baseStart === undefined ? null : content.slice(block.baseStart, block.baseEnd), incoming: content.slice(block.incomingStart, offset) }); block = null;
    }
    offset += line.length;
  }
  return blocks;
}

export function historyGraph(commits) {
  const frontier = [];
  return commits.map(commit => {
    let lane = frontier.indexOf(commit.hash);
    const incoming = lane >= 0;
    if (lane < 0) { lane = frontier.indexOf(null); if (lane < 0) lane = frontier.length; }
    const lines = [];
    for (const [column, hash] of frontier.entries()) if (hash && column !== lane) lines.push({ from: column, to: column, top: 0, bottom: 38 });
    if (incoming) lines.push({ from: lane, to: lane, top: 0, bottom: 19 });
    frontier[lane] = null;
    for (const parent of commit.parents.filter(Boolean)) {
      let column = frontier.indexOf(parent);
      if (column < 0) { column = frontier.indexOf(null); if (column < 0) column = frontier.length; frontier[column] = parent; }
      lines.push({ from: lane, to: column, top: 19, bottom: 38 });
    }
    const columns = Math.max(frontier.length, lane + 1);
    while (frontier.at(-1) === null) frontier.pop();
    return { commit, lane, lines, columns };
  });
}

export function threadGroups(comments) {
  const groups = new Map();
  for (const comment of comments) {
    const key = comment.in_reply_to_id || comment.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(comment);
  }
  return [...groups.values()].map(group => group.sort((a, b) => a.created_at.localeCompare(b.created_at)))
    .sort((a, b) => b.at(-1).created_at.localeCompare(a.at(-1).created_at));
}

export function commentAudience(comment) {
  const author = comment.author || comment.user || {};
  return author.is_bot || author.type === "Bot" || /\[bot\]$/i.test(author.login || "") ? "bot" : "human";
}

// The primary action follows the work still needed on this branch.
export function primaryAction(state) {
  const d = state.data;
  if (!d) return { action: "commit", title: "Commit", icon: "check", disabled: true };
  if (d.files.some(f => f.conflict)) return { action: "commit", title: "Resolve conflicts", icon: "check", disabled: true };
  if (d.files.some(f => f.staged) || state.amend) return { action: "commit", title: state.amend ? "Amend commit" : "Commit", icon: "check", disabled: !state.message.trim() };
  if (d.files.some(f => f.unstaged)) return { action: "stage", title: "Stage All Changes", icon: "plus" };
  if (!d.branch || !d.remotes.length) return { action: "commit", title: "Commit", icon: "check", disabled: true };
  if (!d.upstream) return { action: "push", title: "Publish Branch", icon: "publish" };
  if (d.ahead && d.behind) return { action: "sync", title: `Sync ${d.behind}↓ ${d.ahead}↑`, icon: "refresh" };
  if (d.behind) return { action: "pull", title: `Pull ${d.behind}↓`, icon: "down" };
  if (d.ahead) return { action: "push", title: `Push ${d.ahead}↑`, icon: "up" };
  if (state.github && !state.github.pr && d.branch !== state.base.replace(/^origin\//, "")) return { action: "createPR", title: "Create PR", icon: "pr" };
  return { action: "commit", title: "Commit", icon: "check", disabled: true };
}

export function visibleFiles(files, query, tree, folders = {}) {
  const matches = files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()));
  if (!tree) return matches.map(file => ({ file, depth: 0 }));
  const root = { directories: new Map(), files: [] };
  for (const file of matches) {
    const parts = file.path.split("/"); parts.pop(); let node = root, path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.directories.has(part)) node.directories.set(part, { path, directories: new Map(), files: [] });
      node = node.directories.get(part);
    }
    node.files.push(file);
  }
  const rows = [];
  const visit = (node, depth) => {
    for (const [name, child] of [...node.directories].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({ directory: child.path, name, depth });
      if (!folders[child.path] || query) visit(child, depth + 1);
    }
    for (const file of node.files.sort((a,b) => a.path.localeCompare(b.path))) rows.push({ file, depth });
  };
  visit(root, 0); return rows;
}

export function selectableFiles(state) {
  if (!state.data) return [];
  const groups = [["staged", state.data.files.filter(f => f.staged)], ["unstaged", state.data.files.filter(f => f.unstaged)], ["branch", state.data.branchStats || state.data.comparison || []]];
  return groups.flatMap(([layer, files]) => state.collapsed[layer] ? [] : visibleFiles(files, state.query, state.tree, state.folders)
    .slice(0, state.fileLimit).filter(row => row.file).map(row => ({ file: row.file, layer, key: JSON.stringify([layer, row.file.path]) })));
}

export function selectFiles(state, key, modifiers = {}) {
  const entries = selectableFiles(state), keys = entries.map(entry => entry.key);
  let selection = (state.fileSelection || []).filter(value => keys.includes(value));
  const anchor = keys.indexOf(state.fileAnchor), index = keys.indexOf(key);
  if (modifiers.shift && anchor >= 0 && index >= 0) selection = keys.slice(Math.min(anchor, index), Math.max(anchor, index) + 1);
  else if (modifiers.platform && !modifiers.shift) {
    if (selection.includes(key)) selection = selection.filter(value => value !== key);
    else { selection.push(key); state.fileAnchor = key; }
  }
  else { selection = []; state.fileAnchor = key; }
  state.fileSelection = selection;
  return Boolean((modifiers.platform && !modifiers.shift) || (modifiers.shift && anchor >= 0 && index >= 0));
}

export function checkPresentation(check) {
  const raw = String(check.conclusion || check.state || check.status || "pending").toLowerCase();
  if (raw === "cancelled") return { kind: "cancelled", icon: "cancelled", label: "Cancelled", order: 2 };
  if (["neutral", "skipped"].includes(raw)) return { kind: "neutral", icon: "cancelled", label: raw === "skipped" ? "Skipped" : "Neutral", order: 4 };
  const state = checkState(check);
  return { kind: state, icon: state === "success" ? "passed" : state === "failure" ? "failed" : "pending",
    label: state === "success" ? "Passed" : state === "failure" ? "Failed" : raw === "queued" ? "Queued" : "In progress", order: state === "failure" ? 0 : state === "pending" ? 1 : 3 };
}

export function checkDuration(check) {
  const start = Date.parse(check.startedAt || check.started_at), end = Date.parse(check.completedAt || check.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
