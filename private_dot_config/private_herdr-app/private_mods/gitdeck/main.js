import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, InputState, Input, EditorState, Editor, ScrollHandle, TextView, Popover, Popup } from "gpui-base";
import { appHome, checking, exec, hc, agents, focused, spaces, panes, theme, settings, props, layout, run, openOverlay, closeOverlay, nextCommand, knownAgents, readTextFile, writeTextFile } from "herdr";
import { findNode, agentPRSignal, githubActions, location, makeState, checkState, diffRows, diffFiles, pairedDiffRows, conflictBlocks, historyGraph, threadGroups, commentAudience, primaryAction, visibleFiles, selectableFiles, selectFiles, checkPresentation, checkDuration } from "./model.js";
import { parseNotes, changeNotes, noteQuote, formatNotes } from "./notes.js";

const running = new Set();
const draftFields = ["message", "title", "body", "comment", "base", "headBranch", "draft", "tree", "aiProvider", "aiModel", "aiEffort", "aiInstructions"];
const draftValue = s => Object.fromEntries(draftFields.map(key => [key, s[key]]));
const short = value => String(value || "").slice(0, 8);
const sum = rows => rows.reduce((n, f) => ({ add: n.add + f.add, del: n.del + f.del }), { add: 0, del: 0 });
const label = (value, color) => div().text_size(12).when(Boolean(color), e => e.text_color(color)).child(String(value ?? ""));

export default class Gitdeck extends View {
  init(_props, cx) {
    this.contexts = new Map(); this.remembered = {}; this.focus = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.prScroll = ScrollHandle.new();
    this.s = makeState({ key: "initial" }); this.width = 310; this.height = 700;
    this.inputs = {};
    for (const [key, placeholder] of Object.entries({ historyQuery: "Search commit messages…", metadataQuery: "Search or enter a login…", aiModel: "Default model", query: "Filter files…", base: "Base branch", title: "Pull request title", headBranch: "Head branch (owner:branch for forks)", branchName: "Existing or new branch", prNumber: "PR number", reviewLine: "Line number" })) {
      const input = InputState.new({ placeholder });
      input.on("change", (_e, cx) => { if (key === "base") { this.s.stackParent = null; this.s.stacked = false; } this.s[key] = input.value(); this.s.draftTouched ||= {}; this.s.draftTouched[key] = true; this.saveDraft(cx); cx.notify(); });
      input.on("focus", () => { this.typing = true; }); input.on("blur", (_event, cx) => { this.typing = false; if (key === "base" && this.s.composing && !this.s.editPR) this.findStackParent(cx); });
      this.inputs[key] = input;
    }
    for (const key of ["message", "body", "comment", "agentPrompt", "aiInstructions", "noteBody"]) {
      const input = EditorState.new({ language: "markdown", line_numbers: false, folding: false, soft_wrap: true, font_family: ".AppleSystemUIFont", font_size: 12 });
      input.on("change", (_e, cx) => { this.s[key] = input.value(); this.s.draftTouched ||= {}; this.s.draftTouched[key] = true; this.saveDraft(cx); cx.notify(); });
      input.on("focus", () => { this.typing = true; }); input.on("blur", () => { this.typing = false; });
      this.inputs[key] = input;
    }
    this.setResolution("", "");
    this.inputs.historyQuery.on("submit", (_event, cx) => this.readHistory(cx));
    this.inputs.message.on("submit", (event, cx) => { if (event.secondary) this.commit(cx); });
    this.inputs.noteBody.on("submit", (_event, cx) => this.saveNote(cx));
    this.mode = props()?.mode || (props()?.overlay ? "launcher" : "sidebar");
    if (checking()) return;
    if (this.mode === "launcher") {
      const tree = layout(), node = findNode(tree, n => n.content?.mod === "gitdeck");
      if (node) {
        const panel = findNode(tree, n => n.id === "panel"), stack = findNode(tree, n => n.id === "panel-body");
        if (panel && stack && findNode(stack, n => n === node)) {
          if (!panel.hidden && stack.active === node.id) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: stack.id, child: node.id }); run("layout.show", { id: panel.id }); }
        } else run("layout.toggle", { id: node.id });
        closeOverlay(props().overlay);
      }
      return;
    }
    if (this.mode === "conflict") {
      const p = props(); this.s = makeState(p.context); this.s.data = p.data; this.s.selected = p.selected;
      this.loadConflict(cx); return;
    }
    if (this.mode === "pr") {
      const p = props(); this.s = Object.assign(makeState(p.context), p.snapshot);
      this.s.number = this.s.github.pr.number;
      this.prTab(cx, this.s.prTab);
      if (this.s.data.stateKey) this.restoreDraft(cx, this.s, `${this.s.data.stateKey}-pr-${this.s.number}`);
      cx.timer.every(1000, cx => this.saveDraft(cx));
      cx.timer.every(60000, cx => this.github(cx));
      return;
    }
    if (this.mode === "diff") {
      const p = props(); this.s = makeState(p.context); this.s.data = p.data; this.s.selected = p.selected;
      this.s.base = p.base || p.data.base; this.s.commitFiles = p.commitFiles;
      this.s.diffClosed = Object.fromEntries(diffFiles(this.s).map(file => [file.path, file.path !== p.selected.path]));
      this.loadDiff(cx); this.loadNotes(cx); cx.timer.every(5000, cx => this.loadNotes(cx)); return;
    }
    this.sync(cx);
    cx.timer.every(1000, cx => this.saveDraft(cx));
    cx.timer.every(8000, cx => { this.sync(cx); this.refresh(cx); });
    cx.timer.every(3000, cx => this.watchAgentPR(cx));
    cx.timer.every(60000, cx => { if (this.s.data?.remotes.length) this.github(cx); });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus" || command?.name === "focus") this.focus.focus();
        cx.notify();
      }
    });
  }

  sync(cx) {
    if (this.mode !== "sidebar") return;
    const context = location(focused(), spaces(), panes(), this.remembered);
    if (context.key === this.s.context.key) return;
    if (!this.contexts.has(context.key)) this.contexts.set(context.key, makeState(context));
    this.s = this.contexts.get(context.key);
    for (const [key, input] of Object.entries(this.inputs)) input.set_value(this.s[key] || "");
    this.refresh(cx);
  }

  async request(s, action, args = {}) {
    if (s.context.on) throw new Error("Gitdeck currently requires a local workspace. Open this repository locally.");
    if (!s.context.cwd) throw new Error("Select a terminal in a Git repository");
    const request = { scope: s.context.scope, cwd: s.context.cwd, root: s.data?.root, head: s.data?.head, index: s.data?.index, action,
      ...(s.prRepository && githubActions.has(action) ? { githubRepository: s.prRepository } : {}), ...args };
    const result = await exec("node", [`${appHome()}/mods/gitdeck/service.mjs`, JSON.stringify(request)], { cwd: s.context.cwd, timeout: action === "generate" ? 360000 : 180000 });
    let reply;
    try { reply = JSON.parse(result.stdout); } catch { throw new Error(result.stderr || "Could not start Gitdeck helper. Node 22+ and Git must be on PATH."); }
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  }

  watchAgentPR(cx) {
    const s = this.s, focus = focused(), address = focus?.shown || focus?.terminal || focus?.agent;
    const repository = (s.branchGithub || s.github)?.repository?.url, branch = s.data?.branch;
    if (this.mode !== "sidebar" || s.context.on || !repository || !branch || s.agentPRBusy) return;
    if (!agents().some(agent => agent.address === address && agent.tab === focus.tab && agent.space === focus.space)) return;
    const current = () => this.s === s && s.data?.branch === branch && (s.branchGithub || s.github)?.repository?.url === repository &&
      location(focused(), spaces(), panes(), this.remembered).key === s.context.key &&
      (focused()?.shown || focused()?.terminal || focused()?.agent) === address;
    if (!current()) return;
    const key = `${address}/${branch}`;
    if (s.agentPRWatch?.key !== key) s.agentPRWatch = { key, signal: null, attempts: 0, pending: null };
    const watch = s.agentPRWatch;
    if (watch.pending) { this.showAgentPR(cx, watch); return; }
    s.agentPRBusy = true;
    cx.spawn(async cx => {
      try {
        const output = await hc(["read", address, "--lines", "40"]);
        if (!current() || output.code !== 0) return;
        const signal = agentPRSignal(output.stdout, repository);
        if (!signal) return;
        if (signal.key !== watch.signal) { watch.signal = signal.key; watch.attempts = 3; }
        if (!watch.attempts) return;
        watch.attempts--;
        const github = await this.request(s, "github", { number: signal.number, githubRepository: signal.repository });
        if (!current() || s.agentPRWatch !== watch) return;
        const pr = github.pr;
        if (!pr || (!signal.number && (pr.state !== "OPEN" || pr.headRefName !== branch)) || github.repository?.url.toLowerCase() !== signal.repository.toLowerCase()) return;
        const identity = `${github.repository.url}/pull/${pr.number}`;
        s.autoOpenedPRs ||= new Set();
        if (s.autoOpenedPRs.has(identity)) { watch.attempts = 0; return; }
        watch.pending = { github, identity };
        this.showAgentPR(cx, watch);
      } catch { /* Optional detection retries without replacing Git/PR errors. */ }
      finally { s.agentPRBusy = false; cx.notify(); }
    });
  }

  showAgentPR(cx, watch) {
    const s = this.s;
    if (this.typing || s.busy || s.ghLoading || s.loading || s.composing || s.confirm || s.agentTask || s.aiSettings || s.menu || s.linkPR) return;
    const { github, identity } = watch.pending;
    watch.pending = null; watch.attempts = 0; s.autoOpenedPRs.add(identity);
    s.branchGithub ||= s.github; s.prRepository = github.repository.url;
    s.github = github; s.number = github.pr.number; s.section = "PR"; s.prTab = "Conversation"; s.ghError = "";
    s.threads = []; s.prFiles = []; s.conversation = null; s.runs = []; s.jobs = {}; s.checkDetails = {};
    s.expandedChecks = {}; s.expandedRuns = {}; s.viewedFiles = {}; s.prImagePreviews = {}; s.prClosed = {}; s.prSelected = null; s.log = undefined; s.mergeRequest = null; s.runError = "";
    const tree = layout(), panel = findNode(tree, node => node.id === "panel"), stack = findNode(tree, node => node.id === "panel-body");
    const block = findNode(stack || tree, node => node.content?.mod === "gitdeck");
    if (block && panel && stack) { run("layout.select", { stack: stack.id, child: block.id }); run("layout.show", { id: panel.id }); }
    this.prTab(cx, "Conversation");
    cx.notify();
  }

  leaveAgentPR() {
    const s = this.s;
    if (!s.prRepository) return;
    s.github = s.branchGithub; s.branchGithub = null; s.prRepository = null; s.number = null;
    s.ghRequest++; s.threads = []; s.prFiles = []; s.runs = []; s.conversation = null;
    s.jobs = {}; s.checkDetails = {}; s.expandedChecks = {}; s.expandedRuns = {}; s.viewedFiles = {};
    s.prImagePreviews = {}; s.prClosed = {}; s.prSelected = null; s.log = undefined; s.mergeRequest = null; s.runError = "";
  }

  prOutsideCheckout() {
    const s = this.s;
    return Boolean(s.prRepository && (s.prRepository !== s.branchGithub?.repository?.url || s.github?.pr?.headRefName !== s.data?.branch));
  }

  restoreDraft(cx, s, key) {
    const storage = { path: `${appHome()}/data/gitdeck-draft-${key}.json`, loaded: false, busy: false, expected: null, saved: null };
    s.draftStorage = storage;
    const initial = draftValue(s);
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(storage.path), saved = raw ? JSON.parse(raw) : {};
        if (saved.version && saved.version !== 1) throw new Error("Unsupported saved draft version");
        for (const field of draftFields) {
          if (s.draftTouched?.[field] || s[field] !== initial[field]) continue;
          const value = saved.fields?.[field];
          if (typeof value !== typeof s[field]) continue;
          s[field] = value;
          if (this.s === s && this.inputs[field]) this.inputs[field].set_value(value);
        }
        storage.expected = raw; storage.saved = JSON.stringify(saved.fields || {}); storage.loaded = true;
      } catch (error) { s.draftError = `Draft restore failed: ${error.message}`; }
      cx.notify();
    });
  }

  saveDraft(cx) {
    if (!["sidebar", "pr"].includes(this.mode)) return;
    // Save inactive contexts too: switching a tab must not lose its last keystroke.
    for (const s of new Set([this.s, ...this.contexts.values()])) {
      const storage = s.draftStorage;
      if (!storage?.loaded || storage.busy || storage.conflict) continue;
      const fields = draftValue(s), serialized = JSON.stringify(fields);
      if (serialized === storage.saved) continue;
      storage.busy = true;
      cx.spawn(async cx => {
        try {
          const next = JSON.stringify({ version: 1, fields });
          await writeTextFile(storage.path, next, storage.expected);
          storage.expected = next; storage.saved = serialized; s.draftError = "";
        } catch (error) {
          storage.conflict = true;
          s.draftError = `Draft could not be saved. Your text remains here; another window may have changed the saved draft. ${error.message}`;
        } finally { storage.busy = false; if (!storage.conflict) this.saveDraft(cx); cx.notify(); }
      });
    }
  }

  refresh(cx) {
    const s = this.s;
    if (!s.context.cwd || s.loading || s.busy) return;
    s.loading = true; const sequence = ++s.gitRequest;
    cx.spawn(async cx => {
      try {
        const data = await this.request(s, "status", { base: s.base });
        if (sequence !== s.gitRequest) return;
        const oldHead = s.data?.head; s.data = data; s.error = "";
        if (this.s === s) this.loadNotes(cx);
        if (this.s === s && !s.github && !s.ghLoading && data.remotes.length) this.github(cx);
        if (!s.base) { s.base = data.base; if (this.s === s) this.inputs.base.set_value(s.base); }
        if (data.stateKey && !s.draftStorage) this.restoreDraft(cx, s, data.stateKey);
        if (oldHead && oldHead !== data.head && !s.prRepository) { s.github = null; s.runs = []; s.threads = []; s.prFiles = []; s.jobs = {}; s.checkDetails = {}; s.expandedChecks = {}; s.expandedRuns = {}; s.log = undefined; }
      } catch (error) { s.error = String(error.message || error); }
      finally { s.loading = false; cx.notify(); }
    });
  }

  github(cx) {
    const s = this.s;
    if (s.ghLoading || s.busy) return;
    s.ghLoading = true; const sequence = ++s.ghRequest, head = s.data?.head, number = s.number, repository = s.prRepository;
    cx.spawn(async cx => {
      try {
        const github = await this.request(s, "github", { number });
        let runs = [], runError = "";
        try { runs = await this.request(s, "runs", { sha: github.pr?.headRefOid || head }); }
        catch (error) { runError = String(error.message || error); }
        if (sequence !== s.ghRequest || number !== s.number || head !== s.data?.head || repository !== s.prRepository) return;
        if (github.pr?.number !== s.github?.pr?.number || github.pr?.headRefOid !== s.github?.pr?.headRefOid) { s.threads = []; s.prFiles = []; s.prImagePreviews = {}; s.prClosed = {}; s.prSelected = null; s.jobs = {}; s.checkDetails = {}; s.expandedChecks = {}; s.expandedRuns = {}; s.log = undefined; }
        s.github = github; s.runs = runs; s.runError = runError; s.ghError = "";
        if (this.s === s && s.mergeRequest?.result?.status === "pending" && s.mergeRequest.number === github.pr?.number) this.mergeResult(cx);
        if (this.s === s && (this.mode === "pr" || s.section === "PR") && github.pr) this.prTab(cx, s.prTab);
      } catch (error) { s.ghError = String(error.message || error); }
      finally { s.ghLoading = false; cx.notify(); }
    });
    cx.notify();
  }

  read(cx, action, args, apply, requestKey = action) {
    const s = this.s; s.loadingDetail = action;
    s.detailRequests ||= {}; const sequence = (s.detailRequests[requestKey] || 0) + 1; s.detailRequests[requestKey] = sequence;
    const number = s.number, head = s.data?.head, prNumber = s.github?.pr?.number, prHead = s.github?.pr?.headRefOid, repository = s.prRepository;
    cx.spawn(async cx => {
      try {
        const value = await this.request(s, action, args);
        if (s.detailRequests[requestKey] !== sequence || s.number !== number || s.data?.head !== head || s.github?.pr?.number !== prNumber || s.github?.pr?.headRefOid !== prHead || repository !== s.prRepository) return;
        apply(value, s); s.error = "";
      }
      catch (error) { if (s.detailRequests[requestKey] === sequence && s.number === number && s.data?.head === head && s.github?.pr?.number === prNumber && s.github?.pr?.headRefOid === prHead && repository === s.prRepository) s.error = String(error.message || error); }
      finally { s.loadingDetail = ""; cx.notify(); }
    }); cx.notify();
  }

  mutate(cx, action, args = {}, done) {
    const s = this.s, key = s.data?.root;
    if (!key || s.busy || running.has(key)) { s.error = "A Git operation is already running. Wait for it to finish."; cx.notify(); return; }
    const conflictText = s.conflictValue;
    s.busy = action; s.error = ""; s.actionError = ""; s.notice = ""; s.confirm = null; running.add(key);
    cx.spawn(async cx => {
      try {
        const data = await this.request(s, action, { number: s.github?.pr?.number, prHead: s.github?.pr?.headRefOid, ...args });
        s.notice = data?.status === "pending" ? "Merge request accepted; waiting for GitHub." : data?.status === "enqueued" ? "Added to the merge queue." : data?.status === "failed" ? `Merge failed: ${data.details?.message || "Refresh for details"}` : typeof data === "string" && data.trim() ? data.trim().slice(0, 1500) : `${action} completed`;
        if (done) done(s, data);
      } catch (error) { s.actionError = String(error.message || error); }
      finally {
        s.busy = ""; running.delete(key);
        if (this.s === s) {
          if (this.mode === "conflict") {
            try { s.data = await this.request(s, "status", { base: s.base }); }
            catch (error) { s.error = String(error.message || error); }
            this.loadConflict(cx, conflictText);
          }
          else if (this.mode === "diff") {
            s.busy = "refreshing"; running.add(key);
            s.diffRequest++; s.diffCache = {};
            try {
              s.data = await this.request(s, "status", { base: s.base });
              for (const file of diffFiles(s)) if (!s.diffClosed?.[file.path]) this.loadDiffFile(cx, file);
              s.lines = [];
            }
            catch (error) { s.error = String(error.message || error); }
            finally { s.busy = ""; running.delete(key); }
          } else {
            this.refresh(cx);
            if (s.github || s.section === "PR" || s.section === "Checks") this.github(cx);
            if (s.selected) this.loadDiff(cx);
          }
        }
        cx.notify();
      }
    }); cx.notify();
  }

  confirm(cx, title, description, action, args = {}, done) {
    const s = this.s;
    s.confirm = { title, description, action, args: { root: s.data?.root, head: s.data?.head, index: s.data?.index,
      number: s.github?.pr?.number, prHead: s.github?.pr?.headRefOid,
      ...(s.prRepository && githubActions.has(action) ? { githubRepository: s.prRepository } : {}), ...args, confirm: true }, done }; cx.notify();
  }

  commit(cx, after) {
    const s = this.s;
    if (!s.message.trim() || s.busy || s.loading) return;
    const message = s.message;
    const done = state => { state.amend = false; if (state.message === message) { state.message = ""; if (this.s === state) this.inputs.message.set_value(""); } };
    if (s.amend) this.confirm(cx, "Amend the last commit?", "This rewrites HEAD. If already pushed, updating the remote requires an explicit force-with-lease push.", "commit", { message: s.message, amend: true, after }, done);
    else this.mutate(cx, "commit", { message: s.message, after }, done);
  }

  loadDiff(cx) {
    const s = this.s, selected = s.selected;
    if (!selected) return;
    if (this.mode === "diff") { this.loadDiffFile(cx, selected); return; }
    s.diffLoading = true; s.diff = null; const sequence = ++s.diffRequest;
    cx.spawn(async cx => {
      try {
        const data = await this.request(s, "diff", { ...selected, base: s.base });
        if (s.diffRequest === sequence) { s.diff = data; s.hunk = 0; s.lines = []; }
      } catch (error) { if (s.diffRequest === sequence) s.error = String(error.message || error); }
      finally { if (s.diffRequest === sequence) s.diffLoading = false; cx.notify(); }
    }); cx.notify();
  }

  loadDiffFile(cx, file) {
    const s = this.s;
    s.diffCache ||= {};
    if (s.diffCache[file.path]) return;
    const entry = { loading: true }; s.diffCache[file.path] = entry;
    cx.spawn(async cx => {
      try {
        entry.data = await this.request(s, "diff", { ...file, base: s.base, fullContext: Boolean(s.fullContext) });
        if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.path)) {
          try { entry.data.images = await this.request(s, "images", { ...file, base: s.base, fullContext: Boolean(s.fullContext) }); }
          catch (error) { entry.data.imageError = String(error.message || error); }
        }
      }
      catch (error) { entry.error = String(error.message || error); }
      finally { entry.loading = false; cx.notify(); }
    });
  }

  navigateDiff(cx, file) {
    const s = this.s; s.selected = file; s.lines = []; s.hunk = 0;
    s.diffClosed ||= {}; s.diffClosed[file.path] = false;
    this.loadDiffFile(cx, file);
    this.scroll.scroll_to_item(diffFiles(s).findIndex(item => item.path === file.path)); this.focus.focus(); cx.notify();
  }

  pick(cx, file, layer = "unstaged") {
    this.s.selected = { path: file.path, layer, commit: this.s.selectedCommit?.hash }; this.loadDiff(cx);
  }

  icon(name, color) {
    return svg(`mods/gitdeck/icons/${name}.svg`).size(14).flex_none().text_color(color || theme().muted);
  }

  button(id, title, cx, callback, options = {}) {
    const t = theme();
    return Button.new(id).h(options.small ? 24 : 28).px(options.small ? 6 : 9).gap(5).rounded(5).text_size(12)
      .bg(options.primary ? t.solid : "#00000000").text_color(options.primary ? t.solid_foreground : options.danger ? t.ansi1 : t.foreground)
      .hover(e => e.bg(options.primary ? t.solid : t.hover))
      .disabled(Boolean(options.disabled || (!options.navigation && (this.s.busy || this.s.loading))))
      .when(Boolean(options.disabled || (!options.navigation && (this.s.busy || this.s.loading))), e => e.opacity(0.45))
      .accessibility_label(options.tip || title).when(Boolean(options.tip), e => e.tooltip(options.tip))
      .on_click((_event, cx) => { cx.stop_propagation(); callback(cx); })
      .when(Boolean(options.icon), e => e.child(this.icon(options.icon, options.primary ? t.solid_foreground : undefined)))
      .when(Boolean(title), e => e.child(title));
  }

  iconButton(id, icon, title, cx, callback, options = {}) {
    return this.button(id, "", cx, callback, { small: true, navigation: true, ...options, icon, tip: title }).w(26);
  }

  menu(id, trigger, content) {
    const s = this.s;
    return Popover.new(id).trigger(trigger).open(s.menu === id)
      .on_open_change((open, cx) => { s.menu = open ? id : null; cx.notify(); })
      .when(s.menu === id, e => e.content(content()));
  }

  menuItem(id, title, detail, cx, callback, options = {}) {
    return this.button(id, "", cx, cx => { this.s.menu = null; callback(cx); }, { navigation: true, ...options })
      .w_full().justify_between().accessibility_label(title).child(label(title)).when(Boolean(detail), e => e.child(label(detail, theme().dim).text_size(10)));
  }

  menuSurface() {
    return v_flex().w(252).p(5).gap(2).rounded(8).bg(theme().raised).border(1).border_color(theme().border);
  }

  beginPR(cx) {
    this.leaveAgentPR();
    const s = this.s;
    s.composing = true; s.editPR = false; s.section = "Changes";
    s.headBranch = s.data?.branch || "";
    s.base = s.github?.repository.defaultBranchRef?.name || s.base.replace(/^origin\//, "");
    this.inputs.base.set_value(s.base); this.inputs.headBranch.set_value(s.headBranch); this.inputs.title.focus(); cx.notify();
  }

  primary(cx, action) {
    if (action === "commit") this.commit(cx);
    else if (action === "createPR") this.beginPR(cx);
    else if (action === "sync") this.confirm(cx, "Sync branch?", "Rebase local commits onto the upstream branch, then push. A conflict stops the operation before pushing.", "sync");
    else this.mutate(cx, action);
  }

  commitSurface(cx) {
    const s = this.s, t = theme(), d = s.data, action = primaryAction(s);
    const staged = d.files.some(f => f.staged), remote = d.remotes.length > 0;
    const dropdown = () => this.menuSurface()
      .child(this.menuItem("commit-menu", "Commit", staged ? "⌘ Enter" : "Nothing staged", cx, cx => this.commit(cx), { disabled: !staged || !s.message.trim() }))
      .child(this.menuItem("commit-push", "Commit & Push", "", cx, cx => this.commit(cx, "push"), { disabled: !staged || !s.message.trim() || !remote }))
      .child(this.menuItem("commit-sync", "Commit & Sync", "", cx, cx => this.commit(cx, "sync"), { disabled: !staged || !s.message.trim() || !d.upstream }))
      .child(div().h(1).my(4).bg(t.border))
      .child(this.menuItem("push", "Push", d.upstream ? `${d.ahead} outgoing` : "Sets upstream", cx, cx => this.mutate(cx, "push"), { disabled: !remote }))
      .child(this.menuItem("force-push", "Force Push", "With lease", cx, cx => this.confirm(cx, "Force push with lease?", `Replace upstream only if it still points to ${short(d.upstreamOid)}. ${d.behind} upstream commits may be replaced.`, "push", { force: true, upstreamOid: d.upstreamOid }), { disabled: !d.upstreamOid }))
      .child(this.menuItem("new-pr", "Create PR", "", cx, cx => this.beginPR(cx), { disabled: !s.github || Boolean(s.github.pr) }))
      .child(this.menuItem("pull", "Pull", `${d.behind} incoming`, cx, cx => this.mutate(cx, "pull"), { disabled: !d.upstream }))
      .child(this.menuItem("sync", "Sync", "Rebase & push", cx, cx => this.primary(cx, "sync"), { disabled: !d.upstream }))
      .child(this.menuItem("rebase-base", "Rebase from Base", s.base, cx, cx => this.confirm(cx, "Rebase from base?", `Replay this branch onto ${s.base}. Resolve any conflicts before continuing.`, "rebase", { base: s.base }), { disabled: !s.base }))
      .child(this.menuItem("fetch", "Fetch", "", cx, cx => this.mutate(cx, "fetch"), { disabled: !remote }))
      .child(div().h(1).my(4).bg(t.border))
      .child(this.menuItem("amend", "Amend last commit", s.amend ? "On" : "Off", cx, cx => { s.amend = !s.amend; cx.notify(); }, { disabled: !d.head }))
      .child(this.menuItem("commit-template", "Insert commit template", "", cx, cx => this.read(cx, "template", {}, (value, state) => {
        if (!state.message && value) { state.message = value; if (state === this.s) this.inputs.message.set_value(value); }
        else state.notice = value ? "Clear the message before inserting a template." : "No commit template configured.";
      })));
    return v_flex().px(12).pt(6).pb(4).gap(10)
      .child(div().relative().child(this.input("message", Math.min(130, Math.max(56, s.message.split("\n").length * 17 + 12))).pr(30))
        .child(div().absolute().top(3).right(4).child(this.generateButton(cx, "commit")))
        .when(!s.message, e => e.child(div().absolute().top(6).left(8).text_size(12).text_color(t.muted).child("Message"))))
      .child(h_flex().h(25).border(1).border_color(t.border).rounded(6)
        .child(this.button("commit", s.busy ? `${action.title}…` : action.title, cx, cx => this.primary(cx, action.action), { icon: action.icon, disabled: action.disabled }).flex_1().h(23))
        .child(div().w(1).h_full().bg(t.border))
        .child(this.menu("commit-actions", this.iconButton("commit-actions-trigger", "chevron", "Commit and remote actions", cx, () => {}), dropdown)));
  }

  input(key, height = 30) {
    const t = theme();
    return (key === "message" || key === "body" || key === "comment" || key === "agentPrompt" || key === "aiInstructions" || key === "noteBody" ? Editor.new(this.inputs[key]) : Input.new(this.inputs[key]))
      .h(height).w_full().text_size(12).px(6).bg(t.background).border(1).border_color(t.input).rounded(5).text_color(t.foreground);
  }

  section(cx, title) {
    if (title === "Changes" || title === "History") this.leaveAgentPR();
    this.s.section = title; this.s.confirm = null;
    if (title === "PR" || title === "Checks") this.github(cx);
    if (title === "PR" && this.s.github?.pr) this.prTab(cx, this.s.prTab);
    if (title === "History") this.readHistory(cx);
    cx.notify();
  }

  showDiff(cx) {
    if (!this.s.selected) return;
    openOverlay({ mod: "gitdeck", kind: "dialog", width: 0.88, height: 0.86,
      props: { mode: "diff", context: this.s.context, data: this.s.data, selected: this.s.selected, base: this.s.base, commitFiles: this.s.commitFiles } });
  }

  selectedFiles() {
    const s = this.s, visible = selectableFiles(s), keys = new Set(s.fileSelection || []);
    const selected = visible.filter(entry => keys.has(entry.key));
    s.fileSelection = selected.map(entry => entry.key);
    if (!visible.some(entry => entry.key === s.fileAnchor)) s.fileAnchor = null;
    return selected;
  }

  changeSelected(cx, action) {
    const entries = this.selectedFiles().filter(entry => entry.layer === (action === "stage" ? "unstaged" : "staged"));
    if (!entries.length) return;
    const keys = new Set(entries.map(entry => entry.key));
    this.mutate(cx, action, { paths: entries.map(entry => entry.file.path) }, state => {
      state.fileSelection = (state.fileSelection || []).filter(key => !keys.has(key));
    });
  }

  discardSelected(cx) {
    const paths = this.selectedFiles().filter(entry => entry.layer === "unstaged").map(entry => entry.file.path);
    if (!paths.length) return;
    this.read(cx, "discardPreview", { paths }, (preview, state) => {
      state.confirm = { title: `Discard changes in ${preview.files.length} files?`,
        description: `${preview.files.map(file => file.path).join("\n")}\n\nStaged changes are preserved. Untracked files are deleted.`, action: "discardMany",
        args: { ...preview, root: state.data.root, confirm: true },
        done: state => { state.fileSelection = []; } };
    });
  }

  selectionMenu(cx) {
    const entries = this.selectedFiles(), staged = entries.filter(entry => entry.layer === "staged"), unstaged = entries.filter(entry => entry.layer === "unstaged");
    return this.menuSurface().w(250)
      .child(this.menuItem("stage-selection", "Stage selected", `${unstaged.length}`, cx, cx => this.changeSelected(cx, "stage"), { disabled: !unstaged.length || unstaged.some(entry => entry.file.conflict) }))
      .child(this.menuItem("unstage-selection", "Unstage selected", `${staged.length}`, cx, cx => this.changeSelected(cx, "unstage"), { disabled: !staged.length }))
      .child(this.menuItem("copy-selection", "Copy paths", "", cx, cx => cx.write_to_clipboard([...new Set(entries.map(entry => entry.file.path))].join("\n"))))
      .child(this.menuItem("discard-selection", "Discard selected changes…", "", cx, cx => this.discardSelected(cx), { danger: true, disabled: !unstaged.length || unstaged.some(entry => entry.file.conflict) }));
  }

  fileRow(file, layer, index, cx, depth = 0) {
    const s = this.s, t = theme(), name = file.path.split("/").at(-1), parent = file.path.slice(0, -(name.length + 1));
    const key = JSON.stringify([layer, file.path]), menuId = `file-menu-${layer}-${index}`;
    const selected = s.fileSelection?.length ? s.fileSelection.includes(key) : s.selected?.path === file.path && s.selected?.layer === layer;
    const status = file.conflict ? "!" : file.untracked ? "U" : file.xy?.trim()[0] || "M";
    const tint = file.conflict || status === "D" ? t.ansi1 : status === "A" || status === "U" ? t.ansi2 : t.ansi3;
    const row = h_flex().id(`file-${layer}-${index}`).h(27).min_w(0).gap(5).pl(12 + depth * 14).pr(8)
      .bg(selected ? t.selected : "#00000000").hover(e => e.bg(t.hover))
      .on_click((event, cx) => {
        this.focus.focus();
        if (layer !== "commit" && selectFiles(s, key, event.modifiers)) { cx.notify(); return; }
        if (file.conflict) this.showConflict(cx, file); else { this.pick(cx, file, layer); this.showDiff(cx); }
      })
      .on_mouse_down("right", (_event, cx) => {
        if (layer === "commit") return;
        if (!s.fileSelection?.includes(key)) { s.fileSelection = [key]; s.fileAnchor = key; }
        s.menu = menuId; this.focus.focus(); cx.notify();
      })
      .child(this.icon("file", tint))
      .child(label(name).truncate())
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(file.path).child(s.tree ? "" : parent))
      .when(layer !== "base" && layer !== "commit" && layer !== "branch", e => e.child(this.iconButton(`stage-${layer}-${index}`, layer === "staged" ? "minus" : "plus", layer === "staged" ? "Unstage file" : "Stage file", cx,
        cx => file.conflict ? this.showConflict(cx, file) : this.mutate(cx, layer === "staged" ? "unstage" : "stage", { path: file.path }), { navigation: false, tip: file.conflict ? "Resolve conflict" : undefined })))
      .child(label(status, tint).text_size(11).w(12));
    return layer === "commit" ? row : Popup.new(menuId, row).anchor("bottom_left")
      .when(s.menu === menuId, e => e.content(this.selectionMenu(cx).on_mouse_down_out((_event, cx) => { s.menu = null; cx.notify(); })));
  }

  fileGroup(title, files, layer, cx) {
    const s = this.s, t = theme(), closed = s.collapsed[layer], rows = visibleFiles(files, s.query, s.tree, s.folders);
    const group = v_flex().pt(10)
      .child(h_flex().pl(4).pr(8).gap(2)
        .child(this.button(`group-${layer}`, "", cx, cx => { s.collapsed[layer] = !closed; cx.notify(); }, { small: true, navigation: true, icon: closed ? "right" : "chevron" }).flex_1().justify_start().accessibility_label(`${title}: ${files.length}, ${closed ? "collapsed" : "expanded"}`)
          .child(label(title.toUpperCase(), t.muted).font_weight(600).text_size(11)).child(label(files.length, t.muted).text_size(11)))
        .when(files.length > 0 && ["staged", "unstaged"].includes(layer), e => e.child(this.iconButton(`${layer === "staged" ? "unstage" : "stage"}-all`, layer === "staged" ? "minus" : "plus", layer === "staged" ? "Unstage all changes" : "Stage all changes", cx,
          cx => this.mutate(cx, layer === "staged" ? "unstage" : "stage"), { navigation: false }))));
    if (!closed) for (const [i, row] of rows.slice(0, s.fileLimit).entries()) {
      if (row.directory) group.child(this.button(`dir-${layer}-${i}`, row.name, cx, cx => { s.folders[row.directory] = !s.folders[row.directory]; cx.notify(); }, { small: true, navigation: true, icon: s.folders[row.directory] ? "right" : "chevron" }).justify_start().pl(12 + row.depth * 14));
      else group.child(this.fileRow(row.file, layer, i, cx, row.depth));
    }
    if (!closed && rows.length > s.fileLimit) group.child(this.button(`more-${layer}`, "Show 100 more", cx, cx => { s.fileLimit += 100; cx.notify(); }, { small: true, navigation: true }));
    return group;
  }

  changes(cx) {
    const s = this.s, t = theme(), data = s.data;
    if (!data) return label(s.loading ? "Reading repository…" : "Select a local Git repository", t.muted).p(16);
    const selected = this.selectedFiles();
    const content = v_flex().id("files-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(12);
    if (s.composing) content.child(this.prComposer(cx)); else content.child(this.commitSurface(cx));
    if (selected.length) content.child(h_flex().px(12).pt(6).gap(4)
      .child(label(`${selected.length} selected`, t.muted).flex_1())
      .child(this.menu("selection-actions", this.iconButton("selection-actions-trigger", "more", "Selected file actions", cx, () => {}), () => this.selectionMenu(cx)))
      .child(this.iconButton("clear-selection", "close", "Clear selection", cx, cx => { s.fileSelection = []; s.fileAnchor = null; cx.notify(); })));
    const staged = data.files.filter(f => f.staged), unstaged = data.files.filter(f => f.unstaged);
    if (staged.length) content.child(this.fileGroup("Staged changes", staged, "staged", cx));
    content.child(this.fileGroup("Changes", unstaged, "unstaged", cx));
    if (!data.files.length) content.child(label("No uncommitted changes", t.dim).px(28).py(8));
    if (data.comparisonError) content.child(label(data.comparisonError, t.ansi3).px(12));
    if ((data.branchStats || data.comparison).length) content.child(this.fileGroup("Branch changes", data.branchStats || data.comparison, "branch", cx));
    content.child(this.button("sidebar-ai-notes", `AI NOTES  ${(s.notes || []).length}`, cx, cx => { s.notesOpen = !s.notesOpen; cx.notify(); }, { small: true, navigation: true, icon: s.notesOpen ? "chevron" : "right" }).w_full().justify_start().px(12).mt(8));
    content.child(this.notesPanel(cx));
    for (const operation of data.operations) content.child(v_flex().p(12).gap(6)
      .child(label(`${operation} in progress`, t.ansi3)).child(h_flex().gap(4)
        .child(this.button(`continue-${operation}`, "Continue", cx, cx => this.confirm(cx, `Continue ${operation}?`, "Stage resolved files before continuing.", "continue", { operation })))
        .child(this.button(`abort-${operation}`, "Abort…", cx, cx => this.confirm(cx, `Abort ${operation}?`, "Restore the state before this operation.", "abort", { operation }), { danger: true }))));
    return content;
  }

  diffPreview(cx) {
    const s = this.s, t = theme();
    return v_flex().p(8).gap(6).border_t(1).border_color(t.border).bg(t.background)
      .child(h_flex().min_w(0).gap(5).child(div().flex_1().truncate().text_size(11).child(s.selected.path))
        .child(this.button("expand-diff", "Expand ↗", cx, cx => this.showDiff(cx), { small: true }))
        .child(this.button("close-diff", "×", cx, cx => { s.selected = null; s.diff = null; s.diffRequest++; cx.notify(); }, { small: true })))
      .child(div().h(90).overflow_y_scrollbar().text_size(10).children(s.diffLoading ? [label("Loading diff…", t.dim)] : diffRows(s.diff?.patch || "No text changes").slice(0, 60).map(row => label(row.text.slice(0, 150), row.kind === "add" ? t.ansi2 : row.kind === "del" ? t.ansi1 : t.muted))));
  }

  loadNotes(cx) {
    const s = this.s;
    if (!s.data?.notesKey || s.notesLoading || s.notesBusy) return;
    const key = s.data.notesKey;
    s.notesLoading = true;
    cx.spawn(async cx => {
      try {
        const notes = parseNotes(await readTextFile(`${appHome()}/data/gitdeck-notes-${key}.json`));
        if (s.data?.notesKey === key) { s.notes = notes; s.notesError = ""; }
      }
      catch (error) { s.notesError = String(error.message || error); }
      finally { s.notesLoading = false; cx.notify(); }
    });
  }

  updateNotes(cx, change, done, s = this.s) {
    if (!s.data?.notesKey || s.notesBusy || s.notesLoading) return;
    const key = s.data.notesKey;
    s.notesBusy = true;
    cx.spawn(async cx => {
      try {
        const notes = await changeNotes({ read: readTextFile, write: writeTextFile }, `${appHome()}/data/gitdeck-notes-${key}.json`, change);
        if (s.data?.notesKey === key) { s.notes = notes; s.notesError = ""; done?.(s); }
      } catch (error) { s.notesError = String(error.message || error); }
      finally { s.notesBusy = false; cx.notify(); }
    }); cx.notify();
  }

  noteTarget(file) { return JSON.stringify([file.path, file.layer, ["branch", "base"].includes(file.layer) ? this.s.base : "", file.commit || ""]); }

  startNote(cx, file, line = 0, extend = false) {
    const s = this.s, target = this.noteTarget(file), previous = s.noteDraft;
    if (previous && s.noteBody.trim() && !(extend && !previous.id && previous.target === target)) {
      s.notesError = "Save or cancel the current note before starting another."; cx.notify(); return false;
    }
    const anchor = extend && previous?.target === target && !previous.id ? previous.anchor : line;
    const start = Math.min(anchor, line), end = Math.max(anchor, line);
    const rows = diffRows(s.diffCache?.[file.path]?.data?.patch || s.diff?.patch || "");
    s.noteDraft = { target, path: file.path, layer: file.layer, start, end, anchor, quote: line ? noteQuote(rows, start, end) : "" };
    if (!extend) { s.noteBody = ""; this.inputs.noteBody.set_value(""); }
    this.inputs.noteBody.focus(); cx.notify(); return true;
  }

  beginNoteRange(cx, file, line, extend) {
    const s = this.s;
    s.suppressNoteClick = false;
    s.noteRange = { file: { ...file }, target: this.noteTarget(file), start: line, end: line, extend,
      patch: s.diffCache?.[file.path]?.data?.patch || s.diff?.patch || "" };
    cx.notify();
  }

  moveNoteRange(cx, file, line) {
    const range = this.s.noteRange;
    if (!range || range.target !== this.noteTarget(file) || range.end === line) return;
    range.end = line; cx.notify();
  }

  finishNoteRange(cx, cancel = false) {
    const s = this.s, range = s.noteRange;
    if (!range) return;
    s.noteRange = null;
    s.suppressNoteClick = true;
    if (!cancel) {
      const patch = s.diffCache?.[range.file.path]?.data?.patch || s.diff?.patch || "";
      if (patch !== range.patch) s.notesError = "Diff changed while selecting lines. Select the range again.";
      else if (this.startNote(cx, range.file, range.start, range.extend) && range.end !== range.start) this.startNote(cx, range.file, range.end, true);
    }
    cx.notify();
  }

  saveNote(cx) {
    const s = this.s, draft = s.noteDraft;
    if (!draft || !s.noteBody.trim()) return;
    const note = { ...draft, id: draft.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`, body: s.noteBody.trim() };
    delete note.before;
    this.updateNotes(cx, { before: draft.before ? [draft.before] : [], note }, state => {
      if (state.noteDraft === draft) { state.noteDraft = null; state.noteBody = ""; if (state === this.s) this.inputs.noteBody.set_value(""); }
    });
  }

  noteCard(cx, note, draft = false, panel = false) {
    const s = this.s, t = theme(), root = v_flex().min_w(0).p(9).gap(6).border(1).border_color(t.border).rounded(5).bg(t.surface);
    const key = `${panel ? "panel-" : ""}${note.id || "draft"}`;
    root.child(h_flex().gap(5).child(this.icon("sparkles", t.ansi5))
      .child(label(`${note.path} · ${note.end ? `Line ${note.start === note.end ? note.end : `${note.start}–${note.end}`}` : "File note"}`, t.muted).flex_1().min_w(0).whitespace_normal()));
    if (draft) return root.child(this.input("noteBody", 72)).child(h_flex().gap(5).flex_wrap()
      .child(this.button("save-ai-note", s.notesBusy ? "Saving…" : note.id ? "Save note" : "Add note", cx, cx => this.saveNote(cx), { small: true, primary: true, disabled: !s.noteBody.trim() || s.notesBusy || s.notesLoading || !s.data?.notesKey }))
      .child(this.button("cancel-ai-note", "Cancel", cx, cx => { s.noteDraft = null; s.noteBody = ""; cx.notify(); }, { small: true, navigation: true, disabled: s.notesBusy })));
    return root.child(TextView.markdown(`note-${key}`, note.body).text_size(12))
      .child(h_flex().gap(4).flex_wrap()
        .when(this.mode !== "diff", e => e.child(this.button(`open-note-${key}`, "Open diff", cx, cx => {
          const target = JSON.parse(note.target);
          openOverlay({ mod: "gitdeck", kind: "dialog", width: 0.88, height: 0.86, props: { mode: "diff", context: s.context, data: s.data,
            selected: { path: note.path, layer: note.layer, commit: target[3] || undefined }, base: target[2] || s.base, commitFiles: [{ path: note.path }] } });
        }, { small: true, navigation: true })))
        .child(this.button(`copy-note-${key}`, "Copy", cx, cx => { cx.write_to_clipboard(formatNotes([note])); s.notice = "AI note copied."; cx.notify(); }, { small: true, navigation: true }))
        .child(this.button(`edit-note-${key}`, "Edit", cx, cx => {
          if (s.noteDraft && s.noteBody.trim()) { s.notesError = "Save or cancel the current note before editing another."; cx.notify(); return; }
          s.noteDraft = { ...note, before: note }; s.noteBody = note.body; this.inputs.noteBody.set_value(note.body); this.inputs.noteBody.focus(); cx.notify();
        }, { small: true, navigation: true }))
        .child(this.button(`delete-note-${key}`, "Delete", cx, cx => this.updateNotes(cx, { before: [note] }), { small: true, navigation: true, disabled: s.notesBusy || s.notesLoading })));
  }

  notesPanel(cx) {
    const s = this.s, t = theme(), notes = s.notes || [], root = v_flex().p(10).gap(6);
    if (!s.notesOpen && !s.notesError) return div();
    if (s.notesError) root.child(label(s.notesError, t.ansi1)).child(this.button("retry-notes", "Refresh notes", cx, cx => this.loadNotes(cx), { small: true, navigation: true }));
    if (!s.notesOpen) return root;
    root.child(h_flex().gap(4).child(label(`AI notes · ${notes.length}`, t.muted).flex_1())
      .child(this.button("copy-notes", "Copy", cx, cx => { cx.write_to_clipboard(formatNotes(notes)); s.notice = "AI notes copied."; cx.notify(); }, { small: true, navigation: true, disabled: !notes.length }))
      .child(this.button("send-notes", "Send…", cx, cx => this.prepareNotes(cx, notes), { small: true, navigation: true, disabled: !notes.length }))
      .child(this.button("clear-notes", "Clear…", cx, cx => { s.notesClear = [...notes]; cx.notify(); }, { small: true, navigation: true, disabled: !notes.length })));
    if (s.notesClear) root.child(h_flex().gap(5).child(label(`Delete ${s.notesClear.length} local notes?`, t.muted))
      .child(this.button("confirm-clear-notes", "Delete notes", cx, cx => this.updateNotes(cx, { before: s.notesClear }, state => { state.notesClear = null; }), { small: true, danger: true, disabled: s.notesBusy || s.notesLoading }))
      .child(this.button("cancel-clear-notes", "Cancel", cx, cx => { s.notesClear = null; cx.notify(); }, { small: true, navigation: true })));
    root.child(v_flex().max_h(240).overflow_y_scrollbar().gap(6).children(notes.map(note => s.noteDraft?.id === note.id ? this.noteCard(cx, s.noteDraft, true, true) : this.noteCard(cx, note, false, true))));
    if (s.noteDraft && !s.noteDraft.id) root.child(this.noteCard(cx, s.noteDraft, true, true));
    return root;
  }

  imageDiff(cx, file, images, viewportWidth = 640) {
    const s = this.s, t = theme(); s.imageZoom ||= {};
    const zoom = s.imageZoom[file.path] || 1;
    const available = (viewportWidth - 24 - (s.sideBySide ? 12 : 0)) / (s.sideBySide ? 2 : 1);
    const pane = (title, item, side) => {
      const width = item ? Math.min(item.width, Math.max(40, available - 24), 336 * item.width / item.height) * zoom : 0;
      return v_flex().flex_1().min_w(0).gap(6)
        .child(h_flex().gap(5).flex_wrap().child(label(title, t.muted).flex_1())
          .when(Boolean(item), e => e.child(label(`${item.width} × ${item.height} · ${(item.bytes / 1024).toFixed(1)} KB`, t.dim).text_size(11))))
        .child(div().id(`image-${side}-${file.path}`).h(360).overflow_scroll().bg(t.raised).p(12)
          .child(item ? image(item.path).w(width).h(width * item.height / item.width) : label("No image on this side", t.dim).p(12)));
    };
    return v_flex().id(`image-comparison-${file.path}`).w_full().min_w(0).p(12).gap(8)
      .child(h_flex().gap(4).child(label("Image comparison", t.muted).flex_1())
        .child(this.button(`image-out-${file.path}`, "−", cx, cx => { s.imageZoom[file.path] = Math.max(0.25, zoom / 1.25); cx.notify(); }, { small: true, navigation: true, tip: "Zoom out" }))
        .child(this.button(`image-fit-${file.path}`, zoom === 1 ? "Fit" : `${zoom.toFixed(2)}× fit`, cx, cx => { s.imageZoom[file.path] = 1; cx.notify(); }, { small: true, navigation: true, tip: "Reset image zoom" }))
        .child(this.button(`image-in-${file.path}`, "+", cx, cx => { s.imageZoom[file.path] = Math.min(8, zoom * 1.25); cx.notify(); }, { small: true, navigation: true, tip: "Zoom in" })))
      .child((s.sideBySide ? h_flex() : v_flex()).gap(12).children([pane("Original", images.before, "before"), pane("Modified", images.after, "after")]));
  }

  diffView(cx) {
    const s = this.s, t = theme(), files = diffFiles(s);
    const treeVisible = s.hideDiffTree === undefined ? (s.diffWidth || 900) >= 640 : !s.hideDiffTree;
    const active = files.findIndex(file => file.path === s.selected?.path);
    const allClosed = files.every(file => s.diffClosed?.[file.path]);
    const canStage = ["staged", "unstaged"].includes(s.selected?.layer);
    const verb = s.selected?.layer === "staged" ? "Unstage" : "Stage";
    const move = (cx, offset) => { const file = files[active + offset]; if (file) this.navigateDiff(cx, file); };
    const fileMenu = file => this.menuSurface()
      .child(this.menuItem(`note-file-${file.path}`, "Add AI note", "", cx, cx => this.startNote(cx, file)))
      .child(this.menuItem(`send-file-notes-${file.path}`, "Send this file's notes…", "", cx, cx => this.prepareNotes(cx, s.notes.filter(note => note.path === file.path)), { disabled: !s.notes?.some(note => note.path === file.path) }))
      .child(this.menuItem(`clear-file-notes-${file.path}`, "Clear this file's notes…", "", cx, cx => { s.notesClear = s.notes.filter(note => note.path === file.path); s.notesOpen = true; cx.notify(); }, { disabled: !s.notes?.some(note => note.path === file.path) }))
      .child(this.menuItem(`copy-relative-${file.path}`, "Copy relative path", "", cx, cx => cx.write_to_clipboard(file.path)))
      .child(this.menuItem(`copy-absolute-${file.path}`, "Copy absolute path", "", cx, cx => cx.write_to_clipboard(`${s.data.root}/${file.path}`)))
      .child(this.menuItem(`copy-patch-${file.path}`, "Copy patch", "", cx, cx => cx.write_to_clipboard(s.diffCache?.[file.path]?.data?.patch || "")))
      .when(canStage, e => e.child(this.menuItem(`stage-file-${file.path}`, `${verb} file`, "", cx,
        cx => this.mutate(cx, file.layer === "staged" ? "unstage" : "stage", { path: file.path }))))
      .when(file.layer === "unstaged", e => e.child(this.menuItem(`discard-file-${file.path}`, "Discard changes…", "", cx,
        cx => this.confirm(cx, "Discard unstaged changes?", `Discard changes in ${file.path}. Staged changes are preserved; an untracked file is deleted.`, "discard", { ...file, hash: s.diffCache?.[file.path]?.data?.images?.hash || s.diffCache?.[file.path]?.data?.hash, binary: Boolean(s.diffCache?.[file.path]?.data?.images), fullContext: s.diffCache?.[file.path]?.data?.fullContext }), { disabled: !s.diffCache?.[file.path]?.data })));
    const tree = v_flex().w(218).h_full().min_h(0).flex_none().border_r(1).border_color(t.border).bg(t.surface)
      .child(label(`${files.length} changed files`, t.muted).p(10))
      .child(v_flex().id("diff-files").flex_1().min_h(0).overflow_y_scrollbar().children(files.map((file, i) =>
        Popup.new(`diff-context-${i}`, this.button(`diff-file-${i}`, file.path, cx, cx => { s.menu = null; this.navigateDiff(cx, file); }, { small: true, navigation: true, icon: "file" })
          .justify_start().w_full().rounded(0).bg(file.path === s.selected?.path ? t.selected : "#00000000")
          .tooltip(file.path).on_mouse_down("right", (_event, cx) => { this.navigateDiff(cx, file); s.menu = `diff-context-${i}`; cx.notify(); }))
          .anchor("bottom_left").when(s.menu === `diff-context-${i}`, e => e.content(fileMenu(file)
            .on_mouse_down_out((_event, cx) => { s.menu = null; cx.notify(); }))))));
    const sections = files.map((file, i) => {
      const entry = s.diffCache?.[file.path] || (file.path === s.selected?.path && s.diff ? { data: s.diff } : {});
      const data = entry.data, closed = Boolean(s.diffClosed?.[file.path]);
      const rows = diffRows(data?.patch || "", s.whitespace).filter(row => row.kind !== "meta");
      const sourceRows = diffRows(data?.patch || ""), target = this.noteTarget(file);
      const notes = (s.notes || []).filter(note => note.target === target), placedNotes = new Set();
      let draftPlaced = false;
      const withNotes = (element, row) => {
        element.min_w(s.wrap ? 0 : s.sideBySide ? 1200 : 800);
        if (!row?.next) return element;
        const attached = notes.filter(note => note.end === row.next && note.quote === noteQuote(sourceRows, note.start, note.end));
        const draft = !s.notesOpen && s.noteDraft?.target === target && s.noteDraft.end === row.next;
        if (!attached.length && !draft) return element;
        attached.forEach(note => placedNotes.add(note.id));
        if (draft) draftPlaced = true;
        return v_flex().w_full().min_w(0).child(element).children(attached.filter(note => s.notesOpen || note.id !== s.noteDraft?.id).map(note => div().min_w(0).p(8).child(this.noteCard(cx, note))))
          .when(draft, e => e.child(div().p(8).child(this.noteCard(cx, s.noteDraft, true))));
      };
      const starts = new Map(rows.filter(row => row.kind === "hunk").map(row => [row.hunk, row.index]));
      const stageable = canStage && !s.data.files.find(item => item.path === file.path)?.conflict && !s.data.files.find(item => item.path === file.path)?.untracked;
      const select = (row, cx) => {
        if (s.noteRange || s.suppressNoteClick) return;
        if (!stageable || !["add", "del"].includes(row.kind)) return;
        if (s.selected?.path !== file.path || s.hunk !== row.hunk) { s.lines = []; s.hunk = row.hunk; }
        s.selected = file;
        const line = row.index - starts.get(row.hunk);
        s.lines ||= []; s.lines = s.lines.includes(line) ? s.lines.filter(item => item !== line) : [...s.lines, line]; cx.notify();
      };
      const cell = (row, side) => h_flex().min_h(20).flex_1().min_w(0).gap(8).px(8)
        .when(Boolean(row), e => e.id(`local-diff-line-${i}-${row.index}-${side}`).bg(row.kind === "add" ? t.ansi2 + "18" : row.kind === "del" ? t.ansi1 + "18" : "#00000000")
          .on_click((_event, cx) => select(row, cx))
          .when(s.selected?.path === file.path && s.hunk === row.hunk && (s.lines || []).includes(row.index - starts.get(row.hunk)), el => el.bg(t.selection)))
        .when(Boolean(row?.next && (!s.sideBySide || side === "right")), e => e
          .on_mouse_move((_event, cx) => this.moveNoteRange(cx, file, row.next))
          .when(s.noteRange?.target === target && row.next >= Math.min(s.noteRange.start, s.noteRange.end) && row.next <= Math.max(s.noteRange.start, s.noteRange.end), el => el.bg(t.selection)))
        .child(row?.next && (!s.sideBySide || side === "right") ? this.iconButton(`add-note-${i}-${row.index}`, "plus", "Add AI note (drag or Shift-click for a range)", cx, () => {})
          .w(18).h(18).flex_none()
          .on_mouse_down("left", (event, cx) => { cx.stop_propagation(); this.beginNoteRange(cx, file, row.next, Boolean(event.modifiers?.shift)); })
          .on_click((event, cx) => { cx.stop_propagation(); if (s.noteRange) this.finishNoteRange(cx); else if (!s.suppressNoteClick) this.startNote(cx, file, row.next, Boolean(event.modifiers?.shift)); }) : div().w(18).flex_none())
        .child(label(row ? !s.sideBySide || side === "left" ? row.old ?? "" : row.next ?? "" : "", t.dim).w(34).text_right())
        .when(!s.sideBySide, e => e.child(label(row?.next ?? "", t.dim).w(34).text_right()))
        .child(div().flex_1().min_w(0).when(s.wrap, e => e.whitespace_normal()).font_family(settings().font_family).text_size(12).child(row?.text || ""));
      const hunk = row => h_flex().min_h(28).px(10).gap(8).bg(t.raised)
        .child(label(row.text, t.muted).flex_1().truncate())
        .when(Boolean(stageable), e => e.child(this.button(`hunk-${i}-${row.hunk}`, `${verb} hunk`, cx,
          cx => this.mutate(cx, "hunk", { ...file, hash: data.hash, fullContext: Boolean(data.fullContext), hunk: row.hunk }), { small: true })))
        .when(Boolean(stageable) && s.selected?.path === file.path && s.hunk === row.hunk && Boolean(s.lines?.length), e =>
          e.child(this.button(`lines-${i}-${row.hunk}`, `${verb} ${s.lines.length} ${s.lines.length === 1 ? "line" : "lines"}`, cx,
            cx => this.mutate(cx, "hunk", { ...file, hash: data.hash, fullContext: Boolean(data.fullContext), hunk: row.hunk, lines: s.lines }), { small: true })));
      const section = v_flex().id(`diff-section-${i}`).flex_none().border_b(1).border_color(t.border)
        .child(h_flex().h(34).px(6).gap(6).bg(t.surface)
          .child(this.iconButton(`collapse-diff-${i}`, closed ? "right" : "chevron", closed ? "Expand file" : "Collapse file", cx, cx => {
            s.diffClosed ||= {}; s.diffClosed[file.path] = !closed; if (closed) this.loadDiffFile(cx, file); cx.notify();
          }))
          .child(label(file.path).flex_1().truncate().tooltip(file.path))
          .child(this.menu(`diff-menu-${i}`, this.iconButton(`diff-actions-${i}`, "more", "File actions", cx, () => {}), () => fileMenu(file))));
      if (!closed) {
        if (entry.loading) section.child(label("Loading diff…", t.dim).p(12));
        else if (entry.error) section.child(label(entry.error, t.ansi1).p(12)).child(this.button(`retry-diff-${i}`, "Retry", cx, cx => { delete s.diffCache[file.path]; this.loadDiffFile(cx, file); cx.notify(); }, { small: true, navigation: true }));
        else if (!data) section.child(this.button(`load-diff-${i}`, "Load diff", cx, cx => { this.loadDiffFile(cx, file); cx.notify(); }, { small: true, navigation: true }));
        else if (data.images && !s.imageSource?.[file.path]) section.child(this.imageDiff(cx, file, data.images, (s.diffWidth || 900) - (treeVisible ? 218 : 0)));
        else if (!rows.length) section.child(label(data.patch.includes("Binary files") ? "Binary file changed" : "No text changes", t.dim).p(12));
        else {
          const visible = rows.slice(0, 4000);
          const content = s.sideBySide ? pairedDiffRows(visible).map(pair => pair.left?.kind === "hunk" ? hunk(pair.left) : withNotes(h_flex().children([cell(pair.left, "left"), div().w(1).bg(t.border), cell(pair.right, "right")]), pair.right)) : visible.map(row => row.kind === "hunk" ? hunk(row) : withNotes(cell(row, "right"), row));
          section.child(v_flex().id(`diff-content-${i}`).min_w(0).overflow_x_scrollbar()
            .child(v_flex().w_full().min_w(0).when(Boolean(s.diffWidth), e => e.w(Math.max(0, s.diffWidth - (treeVisible ? 218 : 0)))).children(content)));
          if (rows.length > 4000) section.child(label("Preview limited to 4,000 lines. Copy patch includes the full diff.", t.dim).p(8));
        }
      }
      if (!closed && data?.imageError) section.child(label(`Image preview unavailable: ${data.imageError}`, t.ansi3).p(12));
      if (!closed) {
        for (const note of notes.filter(note => !placedNotes.has(note.id))) section.child(div().p(8)
          .when(note.end > 0, e => e.child(label("Code changed or line outside this preview", t.dim)))
          .child(!s.notesOpen && s.noteDraft?.id === note.id ? this.noteCard(cx, s.noteDraft, true) : this.noteCard(cx, note)));
        if (!s.notesOpen && !draftPlaced && s.noteDraft?.target === target && !s.noteDraft.id) section.child(div().p(8).child(this.noteCard(cx, s.noteDraft, true)));
      }
      if (!closed && data?.images && /\.svg$/i.test(file.path)) section.child(this.button(`image-source-${i}`, s.imageSource?.[file.path] ? "Show image" : "Show SVG source diff", cx, cx => {
        s.imageSource ||= {}; s.imageSource[file.path] = !s.imageSource[file.path]; cx.notify();
      }, { small: true, navigation: true }));
      return section;
    });
    return v_flex().id("local-diff-view").size_full().bg(t.background).text_color(t.foreground).track_focus(this.focus)
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom || 1); if (s.diffWidth !== width) { s.diffWidth = width; cx.notify(); } })
      .on_mouse_down("left", () => { s.suppressNoteClick = false; })
      .on_mouse_up("left", (_event, cx) => this.finishNoteRange(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.finishNoteRange(cx, true); })
      .on_key_down((event, cx) => {
        s.suppressNoteClick = false;
        if (event.key === "escape") { if (s.noteRange) this.finishNoteRange(cx, true); else if (s.noteDraft) { s.noteDraft = null; s.noteBody = ""; cx.notify(); } else if (s.menu) { s.menu = null; cx.notify(); } else closeOverlay(props().overlay); cx.stop_propagation(); }
        else if (event.keystroke === "alt-down" || event.keystroke === "alt-up") { move(cx, event.key === "down" ? 1 : -1); cx.stop_propagation(); }
      })
      .child(h_flex().min_h(36).px(8).py(4).gap(4).flex_wrap().border_b(1).border_color(t.border)
        .child(this.iconButton("toggle-diff-tree", "file", "Toggle file list", cx, cx => { s.hideDiffTree = treeVisible; cx.notify(); }))
        .child(label(`${files.length} changed files · ${s.selected?.layer || ""}`, t.muted).flex_1().min_w(120))
        .child(this.iconButton("previous-diff", "up", "Previous file (Option ↑)", cx, cx => move(cx, -1), { disabled: active <= 0 }))
        .child(this.iconButton("next-diff", "down", "Next file (Option ↓)", cx, cx => move(cx, 1), { disabled: active >= files.length - 1 }))
        .child(this.button("ai-notes", `AI notes ${(s.notes || []).length}`, cx, cx => { s.notesOpen = !s.notesOpen; cx.notify(); }, { small: true, navigation: true, icon: "sparkles" }))
        .child(this.button("collapse-all-diffs", allClosed ? "Expand all" : "Collapse all", cx, cx => { s.diffClosed = Object.fromEntries(files.map(file => [file.path, !allClosed])); if (allClosed) for (const file of files) this.loadDiffFile(cx, file); cx.notify(); }, { small: true, navigation: true }))
        .child(this.button("diff-side-by-side", s.sideBySide ? "Inline" : "Side by side", cx, cx => { s.sideBySide = !s.sideBySide; cx.notify(); }, { small: true, navigation: true }))
        .child(this.button("diff-context", s.fullContext ? "Collapse context" : "Expand context", cx, cx => {
          s.fullContext = !s.fullContext; s.diffCache = {}; s.diff = null; s.lines = [];
          for (const file of files) if (!s.diffClosed?.[file.path]) this.loadDiffFile(cx, file);
          cx.notify();
        }, { small: true, navigation: true }))
        .child(this.button("diff-wrap", s.wrap ? "Wrap on" : "Wrap off", cx, cx => { s.wrap = !s.wrap; cx.notify(); }, { small: true, navigation: true }))
        .child(this.button("diff-whitespace", s.whitespace ? "Whitespace on" : "Whitespace off", cx, cx => { s.whitespace = !s.whitespace; cx.notify(); }, { small: true, navigation: true }))
        .child(this.iconButton("diff-close", "close", "Close diff", cx, () => closeOverlay(props().overlay))))
      .child(this.feedback(cx))
      .child(this.notesPanel(cx))
      .child(h_flex().items_stretch().flex_1().min_h(0).when(treeVisible, e => e.child(tree))
        .child(v_flex().id("diff-scroll").flex_1().h_full().min_w(0).min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(sections)));
  }

  findStackParent(cx) {
    const s = this.s, base = s.base.replace(/^origin\//, "");
    if (s.stackParent?.base === base) return;
    s.stackParent = null; s.stacked = false;
    if (!base || base === s.github?.repository.defaultBranchRef?.name) return;
    this.read(cx, "stackParent", { base }, (parent, state) => {
      if (state.base.replace(/^origin\//, "") === base) state.stackParent = parent;
    });
  }

  prComposer(cx) {
    const s = this.s, t = theme();
    return v_flex().gap(8).p(12)
      .child(h_flex().gap(6).child(this.icon("pr")).child(label(s.editPR ? "Edit pull request" : "New pull request")).child(div().flex_1())
        .child(this.generateButton(cx, "pr"))
        .child(this.iconButton("cancel-compose", "close", "Cancel", cx, cx => { s.composing = false; cx.notify(); })))
      .child(this.input("title", 30)).child(this.input("body", 112))
      .child(h_flex().mt(8).child(label("Base branch", t.muted).text_size(11)).child(div().flex_1()).child(label(`from ${s.headBranch || s.data.branch}`, t.dim).truncate().text_size(11)))
      .child(this.input("base", 30))
      .when(Boolean(s.stackParent) && !s.editPR, e => e.child(this.button("stack-new-pr", `Stack this PR above #${s.stackParent?.number}`, cx, cx => { s.stacked = !s.stacked; cx.notify(); }, { small: true, icon: s.stacked ? "check" : "minus" }).justify_start())
        .when(Boolean(s.stacked), e => e.child(label(s.stackParent?.stackNumber ? `Extend stack #${s.stackParent.stackNumber}` : "Create a GitHub stack with the base PR", t.muted).text_size(11))))
      .when(!s.editPR, e => e.child(this.button("edit-head", "Change head branch…", cx, cx => { s.editHead = !s.editHead; cx.notify(); }, { small: true })).when(s.editHead, e => e.child(this.input("headBranch"))))
      .when(!s.editPR, e => e.child(this.button("draft", "Create as draft", cx, cx => { s.draft = !s.draft; cx.notify(); }, { small: true, icon: s.draft ? "check" : "minus" }).justify_start()))
      .child(h_flex().gap(3)
        .child(this.button("fill-pr", "Fill from commits", cx, cx => this.read(cx, "prDraft", { base: s.base.replace(/^origin\//, "") }, (value, state) => {
          if (!state.title) state.title = value.title; if (!state.body) state.body = value.body;
          if (state === this.s) { this.inputs.title.set_value(state.title); this.inputs.body.set_value(state.body); }
        }), { small: true, disabled: this.prOutsideCheckout() }))
        .child(div().flex_1())
        .when(!s.editPR, e => e.child(this.button("push-first", s.push ? "Push first: on" : "Push first: off", cx, cx => { s.push = !s.push; cx.notify(); }, { small: true }))))
      .child(this.button("submit-pr", s.editPR ? "Save changes" : `${s.push ? "Push & create" : "Create"}${s.draft ? " draft" : ""} PR${s.stacked ? " in stack" : ""}`, cx,
        cx => this.confirm(cx, s.editPR ? "Update pull request?" : "Create pull request?", `${s.title}\n${s.headBranch || s.data.branch} → ${s.base}\n${s.draft ? "Draft" : "Ready for review"}${s.push && !s.editPR ? " · Push to origin first" : ""}${s.stacked && s.stackParent ? `\nStack above #${s.stackParent.number}: ${s.stackParent.title}` : ""}`,
          s.editPR ? "editPR" : "createPR", { title: s.title, body: s.body, base: s.base.replace(/^origin\//, ""), headBranch: s.headBranch, push: s.push, draft: s.draft, ...(s.stacked && s.stackParent && !s.editPR ? { parent: s.stackParent } : {}) }, state => { state.composing = false; state.editPR = false; state.section = "PR"; }),
        { primary: true, icon: "pr", disabled: !s.title.trim() || !s.base.trim() || s.base.replace(/^origin\//, "") === (s.headBranch || s.data.branch) }).w_full());
  }

  prTab(cx, tab) {
    const s = this.s, number = s.github?.pr?.number; s.prTab = tab;
    if (tab === "Files") {
      this.read(cx, "prFiles", { number }, (value, state) => { state.prFiles = value; state.prPage = 1; });
      this.read(cx, "viewedFiles", { number }, (value, state) => { state.viewedFiles = value; });
      this.read(cx, "threads", { number }, (value, state) => { state.threads = value; });
    }
    if (tab === "Conversation") {
      this.read(cx, "threads", { number }, (value, state) => { state.threads = value; });
      this.read(cx, "conversation", { number }, (value, state) => { state.conversation = value; });
    }
    cx.notify();
  }

  showConflict(cx, file) {
    openOverlay({ mod: "gitdeck", kind: "dialog", width: 0.88, height: 0.86,
      props: { mode: "conflict", context: this.s.context, data: this.s.data, selected: { path: file.path } } });
  }

  setResolution(path, value) {
    if (this.resolutionPath === path) { this.resolution.set_value(value); return; }
    const ext = path.split(".").pop().toLowerCase(), t = theme();
    const language = ["ts", "tsx", "mts", "cts", "jsx", "mjs", "cjs"].includes(ext) ? "js" : ext;
    const editor = EditorState.new({ language, value, line_numbers: true, folding: false, font_size: 12,
      font_family: settings().font_family,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    editor.on("change", (_event, cx) => { if (this.resolution === editor) { this.s.conflictValue = editor.value(); cx.notify(); } });
    this.resolution?.release(); this.resolution = editor; this.resolutionPath = path;
  }

  chooseConflict(cx, file) {
    const s = this.s;
    if (s.conflict?.content !== undefined && s.conflictValue !== s.conflict.content) { s.nextConflict = file; cx.notify(); return; }
    s.selected = { path: file.path }; s.conflict = null; s.conflictValue = undefined; s.conflictIndex = 0;
    this.resolution.set_value(""); this.loadConflict(cx);
  }

  loadConflict(cx, savedText) {
    const s = this.s, before = savedText ?? s.conflictValue, path = s.selected.path;
    s.conflictFiles ||= s.data.files.filter(file => file.conflict);
    s.conflictLoading = true; const sequence = (s.conflictRequest || 0) + 1; s.conflictRequest = sequence;
    cx.spawn(async cx => {
      try {
        const data = await this.request(s, "conflict", { path });
        if (sequence !== s.conflictRequest || path !== s.selected.path) return;
        s.conflict = data;
        if (s.conflictValue === before) { s.conflictValue = data.content; this.setResolution(path, data.content || ""); }
        s.error = "";
      } catch (error) { if (sequence === s.conflictRequest) s.error = String(error.message || error); }
      finally { if (sequence === s.conflictRequest) s.conflictLoading = false; cx.notify(); }
    });
  }

  conflictView(cx) {
    const s = this.s, t = theme(), value = s.conflictValue || "", blocks = conflictBlocks(value), editable = s.conflict?.content !== undefined;
    const treeVisible = s.hideConflictTree === undefined ? (s.conflictWidth || 900) >= 640 : !s.hideConflictTree;
    const index = Math.min(s.conflictIndex || 0, Math.max(0, blocks.length - 1)), block = blocks[index];
    const jump = (cx, offset) => {
      s.conflictIndex = (index + offset + blocks.length) % blocks.length;
      const next = blocks[s.conflictIndex];
      if (next) { this.resolution.set_selected_range({ start: next.start, end: next.start }); this.resolution.focus(); }
      cx.notify();
    };
    const accept = (cx, side) => {
      this.resolution.set_selected_range({ start: block.start, end: block.end });
      this.resolution.replace(side === "current" ? block.current : side === "incoming" ? block.incoming : block.current + block.incoming);
      s.conflictValue = this.resolution.value(); cx.notify();
    };
    const save = (cx, stage) => this.mutate(cx, "saveConflict", { path: s.selected.path, hash: s.conflict.hash, content: s.conflictValue, stage, confirm: true });
    return v_flex().id("conflict-view").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom || 1); if (s.conflictWidth !== width) { s.conflictWidth = width; cx.notify(); } })
      .child(h_flex().min_h(38).px(10).py(4).gap(5).flex_wrap().border_b(1).border_color(t.border)
        .child(this.iconButton("conflict-file-tree", "file", "Toggle conflict files", cx, cx => { s.hideConflictTree = treeVisible; cx.notify(); }))
        .child(label(s.selected.path).flex_1().min_w(100).truncate())
        .child(this.button("reload-conflict", "Reload", cx, cx => {
          if (editable && value !== s.conflict.content) { s.reloadConflict = true; cx.notify(); } else this.loadConflict(cx);
        }, { small: true, disabled: s.conflictLoading }))
        .child(this.button("save-conflict", "Save", cx, cx => save(cx, false), { small: true, disabled: !editable || s.conflictLoading }))
        .child(this.button("stage-resolution", "Save and stage", cx, cx => save(cx, true), { small: true, primary: true, disabled: !editable || s.conflictLoading || blocks.length > 0 }))
        .child(this.iconButton("close-conflict", "close", "Close conflict editor", cx, cx => {
          if (editable && value !== s.conflict.content) { s.closeConflict = true; cx.notify(); } else closeOverlay(props().overlay);
        })))
      .child(this.feedback(cx))
      .when(Boolean(s.closeConflict || s.reloadConflict || s.nextConflict), e => e.child(h_flex().p(10).gap(6).flex_wrap()
        .child(label("Discard unsaved editor changes?", t.ansi3).flex_1())
        .child(this.button("discard-editor", "Discard", cx, cx => { if (s.closeConflict) closeOverlay(props().overlay); else if (s.nextConflict) { const file = s.nextConflict; s.nextConflict = null; s.conflictValue = s.conflict.content; this.chooseConflict(cx, file); } else { s.reloadConflict = false; this.loadConflict(cx); } }, { danger: true, small: true }))
        .child(this.button("keep-editor", "Keep editing", cx, cx => { s.closeConflict = false; s.reloadConflict = false; s.nextConflict = null; cx.notify(); }, { small: true }))))
      .child(h_flex().min_h(34).px(10).py(4).gap(5).flex_wrap().bg(t.surface)
        .child(label(blocks.length ? `Conflict ${index + 1} of ${blocks.length} · line ${block.line}` : s.conflict?.kind ? `${s.conflict.kind} conflict` : "No conflict markers", blocks.length ? t.ansi3 : t.muted).flex_1().min_w(150))
        .when(Boolean(block), e => e
          .child(this.iconButton("previous-conflict", "up", "Previous conflict", cx, cx => jump(cx, -1)))
          .child(this.iconButton("next-conflict", "down", "Next conflict", cx, cx => jump(cx, 1)))
          .child(this.button("accept-current", "Accept current", cx, cx => accept(cx, "current"), { small: true }))
          .child(this.button("accept-incoming", "Accept incoming", cx, cx => accept(cx, "incoming"), { small: true }))
          .child(this.button("accept-both", "Accept both", cx, cx => accept(cx, "both"), { small: true }))))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(treeVisible, e => e.child(v_flex().w(205).min_h(0).flex_none().border_r(1).border_color(t.border).overflow_y_scrollbar().id("conflict-files")
          .child(label(`${(s.data.files || []).filter(file => file.conflict).length} unresolved files`, t.muted).p(10))
          .children((s.conflictFiles || s.data.files.filter(file => file.conflict)).map((file, i) => {
            const unresolved = s.data.files.some(item => item.path === file.path && item.conflict);
            return this.button(`conflict-file-${i}`, file.path, cx, cx => this.chooseConflict(cx, file), { small: true, navigation: true, icon: unresolved ? "file" : "check", disabled: s.busy || s.conflictLoading })
              .justify_start().truncate().tooltip(file.path).bg(s.selected.path === file.path ? t.selected : "#00000000");
          }))))
        .child(v_flex().flex_1().min_w(0).min_h(0)
          .when(Boolean(block), e => e.child(h_flex().h(130).items_stretch().border_b(1).border_color(t.border)
            .children([["Current", block.current, t.ansi2], ...(block.base === null ? [] : [["Base", block.base, t.muted]]), ["Incoming", block.incoming, t.ansi4]].map(([title, content, color], i) =>
              v_flex().flex_1().min_w(0).border_l(3).border_color(color).child(label(title, color).px(8).py(5))
                .child(div().id(`conflict-version-${i}`).flex_1().min_h(0).overflow_y_scrollbar().p(8).text_size(12).font_family("monospace").child(content || "(empty)"))))))
          .child(editable ? Editor.new(this.resolution).flex_1().min_h(0).w_full()
            : label(s.conflict?.guidance || (s.conflictLoading ? "Loading conflict…" : "Could not load this conflict"), t.muted).p(16))));
  }

  showPR(cx) {
    const s = this.s;
    if (!s.github?.pr) return;
    const snapshot = Object.fromEntries(["data", "github", "prRepository", "runs", "threads", "conversation", "prFiles", "viewedFiles", "jobs", "prTab", "base"].map(key => [key, s[key]]));
    openOverlay({ mod: "gitdeck", kind: "dialog", width: 0.9, height: 0.9, props: { mode: "pr", context: s.context, snapshot } });
  }

  prView(cx) {
    const s = this.s, t = theme(), pr = s.github?.pr;
    if (s.composing) return this.prComposer(cx);
    const root = v_flex().id("pr-view").gap(0).when(this.mode === "pr", e => e.flex_1().min_h(0))
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom || 1); if (s.prWidth !== width) { s.prWidth = width; cx.notify(); } });
    if (s.linkPR) root.child(h_flex().p(12).gap(4).child(this.input("prNumber")).child(this.button("link-pr", "Open", cx, cx => {
      s.number = Number(s.prNumber); s.linkPR = false; s.threads = []; s.prFiles = []; this.github(cx);
    }, { small: true, disabled: !/^[1-9]\d*$/.test(s.prNumber || "") })));
    if (!pr) return root.child(label(s.ghLoading ? "Looking for a pull request…" : s.ghError ? "GitHub unavailable" : "No pull request for this branch", t.muted).p(12))
      .child(this.button("new-pr", "Create pull request", cx, cx => this.beginPR(cx), { primary: true, disabled: !s.github || !s.data?.branch }).mx(12));
    const menu = () => this.menuSurface()
      .child(this.menuItem("pr-browser", "Open on GitHub", "", cx, cx => cx.open_url(pr.url)))
      .child(this.menuItem("pr-copy", "Copy link", "", cx, cx => cx.write_to_clipboard(pr.url)))
      .child(this.menuItem("pr-edit", "Edit title & description", "", cx, cx => {
        s.composing = true; s.editPR = true; s.title = pr.title; s.body = pr.body; s.base = pr.baseRefName;
        for (const key of ["title", "body", "base"]) this.inputs[key].set_value(s[key]); cx.notify();
      }))
      .when(pr.state === "OPEN", e => e.child(this.menuItem("close-pr", "Close pull request…", "", cx, cx => this.confirm(cx, "Close pull request?", pr.title, "closePR"), { danger: true })))
      .when(pr.state === "CLOSED", e => e.child(this.menuItem("reopen-pr", "Reopen pull request…", "", cx, cx => this.confirm(cx, "Reopen pull request?", pr.title, "reopenPR"))))
      .child(this.menuItem("branch-pr", "Show this branch's PR", "", cx, cx => { this.leaveAgentPR(); s.number = null; this.github(cx); }));
    root.child(v_flex().px(12).py(10).gap(8)
      .child(h_flex().gap(5).child(this.icon("pr", pr.state === "MERGED" ? t.ansi5 : t.ansi2))
        .child(label(`${pr.isDraft ? "Draft" : pr.state === "OPEN" ? "Open" : pr.state === "MERGED" ? "Merged" : "Closed"}  #${pr.number}`, t.muted))
        .child(div().flex_1())
        .when(this.mode !== "pr", e => e.child(this.iconButton("expand-pr", "external", "Expand pull request", cx, cx => this.showPR(cx))))
        .child(this.menu("pr-actions", this.iconButton("pr-more", "more", "Pull request actions", cx, () => {}), menu)))
      .child(div().text_size(16).font_weight(600).child(pr.title))
      .when(Boolean(s.prRepository), e => e.child(label(s.github.repository.nameWithOwner || s.prRepository, t.muted).text_size(11)))
      .child(label(`${pr.headRefName} → ${pr.baseRefName}`, t.dim).text_size(11))
      .child(h_flex().gap(6).child(label(`+${pr.additions}`, t.ansi2)).child(label(`−${pr.deletions}`, t.ansi1)).child(label(`${pr.changedFiles} files`, t.dim))));
    root.child(h_flex().px(8).gap(2).border_b(1).border_color(t.border).children(["Conversation", "Checks", "Files"].map(tab =>
      this.button(`pr-tab-${tab}`, tab === "Files" ? `Files ${pr.changedFiles}` : tab, cx, cx => this.prTab(cx, tab), { small: true, navigation: true })
        .when(this.mode !== "pr", e => e.flex_1()).h(32).rounded(0).border_b(s.prTab === tab ? 2 : 0).border_color(t.foreground).text_color(s.prTab === tab ? t.foreground : t.muted))));
    if (this.mode === "pr") {
      if (s.prTab === "Files") return root.child(this.prFiles(cx));
      const body = s.prTab === "Checks" ? this.checks(cx) : this.prConversation(cx);
      if (s.prTab === "Conversation" && s.prWidth && s.prWidth < 640) return root.child(
        v_flex().id("pr-detail-stacked").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().child(body)
          .child(v_flex().p(12).gap(12).border_t(1).border_color(t.border).child(this.prMetadata(cx)).child(this.mergePanel(cx))));
      return root.child(h_flex().items_stretch().flex_1().min_h(0)
        .child(v_flex().id("pr-detail-body").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().child(body))
        .when(s.prTab === "Conversation", e => e.child(v_flex().id("pr-detail-metadata").w(260).flex_none().min_h(0).overflow_y_scrollbar().p(12).border_l(1).border_color(t.border)
          .child(this.prMetadata(cx)).child(this.mergePanel(cx)))));
    }
    if (s.prTab === "Checks") return root.child(this.checks(cx));
    if (s.prTab === "Files") return root.child(this.prFiles(cx));
    return root.child(this.prConversation(cx));
  }

  loadPRImage(cx, file) {
    const s = this.s, { number, headRefOid } = s.github.pr;
    s.prImagePreviews ||= {};
    const entry = { loading: true }; s.prImagePreviews[file.filename] = entry;
    cx.spawn(async cx => {
      try {
        const images = await this.request(s, "prImages", { number, prHead: headRefOid, path: file.filename });
        if (s.github?.pr?.number === number && s.github?.pr?.headRefOid === headRefOid) entry.images = images;
      } catch (error) { entry.error = String(error.message || error); }
      finally { entry.loading = false; cx.notify(); }
    }); cx.notify();
  }

  prFiles(cx) {
    const s = this.s, t = theme(), pr = s.github.pr, expanded = this.mode === "pr";
    const treeVisible = expanded && (s.hidePRTree === undefined ? (s.prFilesWidth || 900) >= 640 : !s.hidePRTree);
    const root = v_flex().id("pr-files-view").min_w(0).when(expanded, e => e.flex_1().min_h(0))
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom || 1); if (s.prFilesWidth !== width) { s.prFilesWidth = width; cx.notify(); } });
    const files = v_flex().id("pr-files-scroll").gap(8).p(12).min_w(0)
      .when(expanded, e => e.flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.prScroll));
    const allClosed = s.prFiles.length > 0 && s.prFiles.every(file => s.prClosed?.[file.filename]);
    root.child(h_flex().px(8).py(4).gap(4).flex_wrap().border_b(1).border_color(t.border)
      .when(expanded, e => e.child(this.iconButton("pr-file-tree", "file", "Toggle file list", cx, cx => { s.hidePRTree = treeVisible; cx.notify(); })))
      .child(label(`${s.prFiles.filter(file => s.viewedFiles?.[file.filename] === "VIEWED").length} / ${pr.changedFiles ?? s.prFiles.length} files viewed`, t.muted).flex_1().min_w(100))
      .child(this.button("pr-collapse-all", allClosed ? "Expand all" : "Collapse all", cx, cx => {
        s.prClosed = Object.fromEntries(s.prFiles.map(file => [file.filename, !allClosed])); cx.notify();
      }, { small: true, navigation: true }))
      .child(this.button("pr-diff-layout", s.sideBySide ? "Inline" : "Side by side", cx, cx => { s.sideBySide = !s.sideBySide; cx.notify(); }, { small: true, navigation: true })));
    const navigate = (file, index, cx) => { s.prClosed ||= {}; s.prClosed[file.filename] = false; s.prSelected = file.filename; this.prScroll.scroll_to_item(index); cx.notify(); };
    const tree = v_flex().w(218).flex_none().min_h(0).border_r(1).border_color(t.border)
      .child(v_flex().id("pr-file-list").flex_1().min_h(0).overflow_y_scrollbar().children(s.prFiles.map((file, index) =>
        this.button(`pr-navigate-${index}`, file.filename, cx, cx => navigate(file, index, cx), { small: true, navigation: true, icon: s.viewedFiles?.[file.filename] === "VIEWED" ? "check" : "file", tip: file.filename })
          .justify_start().w_full().rounded(0).bg(s.prSelected === file.filename ? t.selected : "#00000000"))));
    if (!s.prFiles.length) files.child(label(s.loadingDetail ? "Loading files…" : "No files loaded", t.dim));
    for (const [index, file] of s.prFiles.entries()) {
      const preview = s.prImagePreviews?.[file.filename], imageFile = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.filename);
      const closed = Boolean(s.prClosed?.[file.filename]);
      const card = v_flex().min_w(0).border(1).border_color(t.border).rounded(5)
        .child(h_flex().p(6).gap(4)
          .child(this.iconButton(`pr-collapse-${index}`, closed ? "right" : "chevron", closed ? "Expand file" : "Collapse file", cx, cx => { s.prClosed ||= {}; s.prClosed[file.filename] = !closed; cx.notify(); }))
          .child(label(file.filename).flex_1().min_w(0).truncate().tooltip(file.filename))
          .child(this.button(`viewed-file-${index}`, "Viewed", cx,
            cx => this.mutate(cx, "viewFile", { path: file.filename, viewed: s.viewedFiles?.[file.filename] !== "VIEWED" }),
            { small: true, icon: s.viewedFiles?.[file.filename] === "VIEWED" ? "check" : "minus", tip: s.viewedFiles?.[file.filename] === "DISMISSED" ? "Changed since your last review" : "Toggle viewed" })));
      if (closed) { files.child(card); continue; }
      const threads = threadGroups(s.threads).filter(group => group[0].path === file.filename), placed = new Set();
      let draftPlaced = false;
      const composer = () => v_flex().id("inline-comment-editor").min_w(0).p(8).gap(6)
        .child(label(`Comment on line ${s.reviewLine} · ${s.reviewSide === "LEFT" ? "old" : "new"}`, t.muted).text_size(11))
        .child(this.input("comment", 80))
        .child(h_flex().gap(4).flex_wrap()
          .child(this.button("post-inline", "Add comment", cx, cx => this.confirm(cx, "Post line comment?", s.comment, "inlineComment",
            { body: s.comment, path: s.reviewPath, line: s.reviewLine, side: s.reviewSide }, state => { state.comment = ""; state.reviewPath = null; if (state === this.s) this.inputs.comment.set_value(""); }), { primary: true, disabled: !s.comment.trim() }))
          .child(this.button("cancel-inline", "Cancel", cx, cx => { s.reviewPath = null; cx.notify(); }, { small: true })));
      if (!preview?.images && file.patch) {
        const rows = diffRows(file.patch).filter(row => row.kind !== "meta");
        const cell = (row, side) => {
          if (!row) return div().flex_1().min_w(0);
          const line = side === "LEFT" ? row.old : side === "RIGHT" ? row.next : row.next || row.old;
          const commentSide = side || (row.next ? "RIGHT" : "LEFT");
          const selected = s.reviewPath === file.filename && Number(s.reviewLine) === line && s.reviewSide === commentSide;
          return h_flex().id(`pr-line-${index}-${row.index}${side ? `-${side}` : ""}`).flex_1().min_w(0).gap(4).px(5).min_h(19)
            .bg(selected ? t.selected : row.kind === "add" ? t.ansi2 + "12" : row.kind === "del" ? t.ansi1 + "12" : t.background)
            .when(Boolean(line), e => e.hover(e => e.bg(t.hover)).tooltip("Comment on this line").on_click((_event, cx) => {
              s.reviewPath = file.filename; s.reviewLine = String(line); s.reviewSide = commentSide; s.replyTo = null;
              this.inputs.reviewLine.set_value(s.reviewLine); this.inputs.comment.focus(); cx.notify();
            }))
            .child(label(side ? line ?? "" : row.old ?? "", t.dim).w(28).flex_none().text_size(10))
            .when(!side, e => e.child(label(row.next ?? "", t.dim).w(28).flex_none().text_size(10)))
            .child(label(row.text, row.kind === "add" ? t.ansi2 : row.kind === "del" ? t.ansi1 : t.muted).font_family(settings().font_family).text_size(11));
        };
        const visible = rows.slice(0, 4000);
        const withThreads = (element, left, right) => {
          element.min_w(s.sideBySide ? 1000 : 600);
          const matching = threads.filter(([first]) => !placed.has(first.id) && !first.isOutdated && first.line &&
            (first.side === "LEFT" ? left?.old : right?.next) === first.line);
          const draft = !draftPlaced && s.reviewPath === file.filename &&
            (s.reviewSide === "LEFT" ? left?.old : right?.next) === Number(s.reviewLine);
          if (!matching.length && !draft) return element;
          for (const [first] of matching) placed.add(first.id);
          if (draft) draftPlaced = true;
          return v_flex().w_full().min_w(0).child(element)
            .children(matching.map(group => div().id(`inline-thread-${group[0].id}`).min_w(0).p(8).child(this.reviewThread(cx, group, true))))
            .when(draft, e => e.child(composer()));
        };
        const content = s.sideBySide ? pairedDiffRows(visible).map(pair => withThreads(
          pair.left?.kind === "hunk" ? cell(pair.left) : h_flex().items_stretch().children([cell(pair.left, "LEFT"), div().w(1).bg(t.border), cell(pair.right, "RIGHT")]), pair.left, pair.right))
          : visible.map(row => withThreads(cell(row), row, row));
        card.child(div().id(`pr-diff-content-${index}`).min_w(0).overflow_x_scrollbar().when(!expanded, e => e.max_h(360).overflow_y_scrollbar())
          .child(v_flex().w_full().min_w(0).when(Boolean(s.prFilesWidth), e => e.w(Math.max(0, s.prFilesWidth - (treeVisible ? 218 : 0) - 26))).children(content)));
        if (rows.length > 4000) card.child(label("Preview limited to 4,000 lines. Open on GitHub for the full diff.", t.dim).p(8));
      }
      if (preview?.images) card.child(this.imageDiff(cx, { path: file.filename }, preview.images, (s.prFilesWidth || 640) - (treeVisible ? 218 : 0) - 26));
      if (imageFile) card.child(h_flex().p(6).gap(5)
        .child(this.button(`pr-image-${index}`, preview?.loading ? "Loading image…" : preview?.images ? "Refresh image" : "Preview image", cx, cx => this.loadPRImage(cx, file), { small: true, navigation: true, disabled: preview?.loading }))
        .when(Boolean(preview?.images), e => e.child(this.button(`pr-image-source-${index}`, "Show diff", cx, cx => { delete s.prImagePreviews[file.filename]; cx.notify(); }, { small: true, navigation: true })))
        .when(Boolean(preview?.error), e => e.child(label(preview.error, t.ansi1).text_size(11))));
      if (!file.patch && !imageFile) card.child(label("No text diff available", t.dim).p(8));
      for (const group of threads.filter(([first]) => !placed.has(first.id))) card.child(div().id(`unplaced-thread-${group[0].id}`).p(8)
        .child(label(group[0].isOutdated ? "Outdated thread" : "Thread outside the displayed diff", t.dim).pb(6))
        .child(this.reviewThread(cx, group, true)));
      if (s.reviewPath === file.filename && !draftPlaced) card.child(composer());
      files.child(card);
    }
    if (s.prFiles.length && s.prFiles.length % 100 === 0) files.child(this.button("more-pr-files", "Load more files", cx,
      cx => this.read(cx, "prFiles", { number: pr.number, page: (s.prPage || 1) + 1 }, (value, state) => { state.prFiles.push(...value); state.prPage++; }), { small: true }));
    return root.child(expanded ? h_flex().items_stretch().flex_1().min_h(0).when(treeVisible, e => e.child(tree)).child(files) : files);
  }

  prMetadata(cx) {
    const s = this.s, pr = s.github.pr, t = theme(), root = v_flex().gap(8);
    for (const [field, title] of [["reviewers", "Reviewers"], ["assignees", "Assignees"], ["labels", "Labels"]]) {
      const selected = (field === "reviewers" ? pr.reviewRequests : pr[field]) || [];
      const valueOf = item => field === "labels" ? item.name : item.login || (item.slug ? `${s.github.repository.nameWithOwner.split("/")[0]}/${item.slug}` : item.name);
      const values = selected.map(valueOf).filter(Boolean);
      const section = v_flex().gap(4).child(h_flex().gap(4)
        .child(label(title.toUpperCase(), t.dim).text_size(10).font_weight(600).flex_1())
        .child(this.iconButton(`edit-${field}`, "edit", `Edit ${title.toLowerCase()}`, cx, cx => {
          if (s.metadataField === field) s.metadataField = null;
          else {
            s.metadataField = field; s.metadataQuery = ""; this.inputs.metadataQuery.set_value("");
            this.read(cx, "metadata", { field }, (items, state) => { state.metadataOptions ||= {}; state.metadataOptions[field] = items; }, `metadata-${field}`);
          }
          cx.notify();
        })));
      section.child(label(values.join(", ") || "None", values.length ? t.foreground : t.dim).text_size(11));
      if (field === "reviewers") {
        const latest = new Map();
        for (const review of pr.reviews || []) if (review.author?.login && review.state !== "COMMENTED") latest.set(review.author.login, review.state);
        for (const [login, state] of latest) section.child(h_flex().gap(5)
          .child(this.icon(state === "APPROVED" ? "passed" : state === "CHANGES_REQUESTED" ? "failed" : "pending"))
          .child(label(`${login} · ${state.toLowerCase().replace(/_/g, " ")}`, t.muted).text_size(11)));
      }
      if (s.metadataField === field) {
        const query = (s.metadataQuery || "").trim(), rows = new Map();
        for (const item of [...selected, ...(s.metadataOptions?.[field] || [])]) { const value = valueOf(item); if (value) rows.set(value, item); }
        const candidates = [...rows.keys()].filter(value => value.toLowerCase().includes(query.toLowerCase()) && (field !== "reviewers" || value.toLowerCase() !== pr.author?.login?.toLowerCase()));
        const choose = (cx, value) => this.mutate(cx, "updateMetadata", { field, value, add: !values.includes(value) });
        section.child(this.input("metadataQuery", 28));
        if (s.loadingDetail === "metadata") section.child(label("Loading…", t.dim));
        section.child(v_flex().max_h(180).overflow_y_scrollbar().children(candidates.slice(0, 100).map((value, i) =>
          this.button(`metadata-${field}-${i}`, value, cx, cx => choose(cx, value), { small: true, icon: values.includes(value) ? "check" : "plus" }).justify_start().w_full())));
        if (field !== "labels" && /^[a-z\d-]+(?:\/[a-z\d-]+)?$/i.test(query) && !rows.has(query)) section.child(
          this.button(`add-${field}`, `Add ${query}`, cx, cx => choose(cx, query), { small: true, icon: "plus" }));
      }
      root.child(section);
    }
    return root;
  }

  reviewThread(cx, group, inline = false) {
    const s = this.s, t = theme(), pr = s.github.pr;
    const first = group[0];
    const card = v_flex().min_w(0).gap(8).p(9).border(1).border_color(t.border).rounded(5)
      .child(label(`${first.path}:${first.line || first.original_line || ""}${first.isResolved ? " · Resolved" : ""}${first.isOutdated ? " · Outdated" : ""}`, t.muted).text_size(11).whitespace_normal());
    for (const comment of group) card.child(label(comment.user?.login || "deleted").font_weight(600)).child(TextView.markdown(`thread-${comment.id}`, comment.body).text_size(12))
      .child(this.reactions(comment, true, cx));
    const actions = h_flex().gap(4).flex_wrap();
    actions.child(this.button(`reply-${group[0].id}`, "Reply…", cx, cx => { s.reviewPath = null; s.replyTo = group[0].id; s.replyLabel = group[0].user?.login || "deleted"; this.inputs.comment.focus(); cx.notify(); }, { small: true }));
    actions.child(this.button(`fix-thread-${first.id}`, "Address with AI…", cx, cx => this.prepareAgent(cx, "Address review comments", [
      pr.url, `${first.path}:${first.line || first.original_line || ""}`,
      ...group.map(comment => `${comment.user?.login || "deleted"}: ${comment.body}`),
      "Do not resolve the thread or post a reply automatically.",
    ].join("\n\n")), { small: true }));
    if (first.threadId && (first.isResolved ? first.canUnresolve : first.canResolve)) actions.child(this.button(`resolve-${first.id}`, first.isResolved ? "Reopen thread" : "Resolve thread", cx,
      cx => this.mutate(cx, "resolveThread", { threadId: first.threadId, resolved: !first.isResolved }), { small: true, icon: "check" }));
    card.child(actions).id(`thread-group-${first.id}`);
    if (inline && s.replyTo === first.id) card.child(v_flex().gap(6)
      .child(this.input("comment", 80))
      .child(h_flex().gap(4)
        .child(this.button(`post-thread-reply-${first.id}`, "Reply", cx, cx => this.confirm(cx, "Post reply?", s.comment, "reply",
          { body: s.comment, commentId: first.id }, state => { state.comment = ""; state.replyTo = null; if (state === this.s) this.inputs.comment.set_value(""); }), { primary: true, disabled: !s.comment.trim() }))
        .child(this.button(`cancel-thread-reply-${first.id}`, "Cancel", cx, cx => { s.replyTo = null; cx.notify(); }, { small: true }))));
    return card;
  }

  prConversation(cx) {
    const s = this.s, t = theme(), pr = s.github.pr, root = v_flex().p(12).gap(12);
    root.child(TextView.markdown("pr-description", pr.body || "_No description provided._").text_size(12));
    if (this.mode !== "pr") root.child(this.prMetadata(cx));
    root.child(h_flex().gap(5).child(label("ACTIVITY", t.dim).text_size(11).font_weight(600)).child(div().flex_1())
      .child(this.iconButton("review-threads", "refresh", "Refresh conversation", cx, cx => this.prTab(cx, "Conversation"))));
    const events = [...(s.conversation || pr.comments || []).map(c => ({ ...c, author: c.author || c.user, date: c.createdAt || c.created_at })), ...(pr.reviews || []).map(c => ({ ...c, date: c.submittedAt }))].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const comments = [...events, ...s.threads];
    const counts = { all: comments.length, human: comments.filter(c => commentAudience(c) === "human").length, bot: comments.filter(c => commentAudience(c) === "bot").length };
    const audience = s.commentAudience || "all", visible = comment => audience === "all" || commentAudience(comment) === audience;
    root.child(h_flex().gap(2).border(1).border_color(t.border).rounded(5).p(2).children([["all", "All"], ["human", "Humans"], ["bot", "Bots"]].map(([value, title]) =>
      this.button(`audience-${value}`, `${title} ${counts[value]}`, cx, cx => { s.commentAudience = value; cx.notify(); }, { small: true, navigation: true }).flex_1().bg(audience === value ? t.selected : "#00000000"))));
    if (!counts[audience]) root.child(label("No comments yet", t.dim).py(8));
    for (const [i, event] of events.filter(visible).entries()) root.child(v_flex().gap(6).pl(10).border_l(1).border_color(t.border)
      .child(label(`${event.author?.login || "deleted"} · ${(event.state || "commented").toLowerCase().replace(/_/g, " ")}`, t.muted))
      .child(label((event.date || "").slice(0, 16).replace("T", " "), t.dim).text_size(10))
      .child(TextView.markdown(`timeline-${i}`, event.body || "_No comment._").text_size(12))
      .when(typeof event.id === "number", e => e.child(this.reactions(event, false, cx))));
    for (const group of threadGroups(s.threads).filter(group => group.some(visible))) root.child(this.reviewThread(cx, group));
    if (s.reviewPath) root.child(label(`Comment on ${s.reviewPath}`, t.muted)).child(this.input("reviewLine"))
      .child(this.button("review-side", s.reviewSide === "LEFT" ? "Old side" : "New side", cx, cx => { s.reviewSide = s.reviewSide === "LEFT" ? "RIGHT" : "LEFT"; cx.notify(); }, { small: true }));
    root.child(label(s.replyTo ? `Reply to ${s.replyLabel}` : "Leave a comment", t.muted)).child(this.input("comment", 80))
      .child(h_flex().gap(4)
        .child(this.button("send-comment", s.replyTo ? "Reply" : "Comment", cx, cx => this.confirm(cx, s.replyTo ? "Post reply?" : "Post comment?", s.comment,
          s.replyTo ? "reply" : s.reviewPath ? "inlineComment" : "comment", { body: s.comment, commentId: s.replyTo, path: s.reviewPath, line: s.reviewLine, side: s.reviewSide }, state => { state.comment = ""; state.replyTo = null; state.reviewPath = null; if (state === this.s) this.inputs.comment.set_value(""); }), { primary: true, disabled: !s.comment.trim() || (s.reviewPath && !/^[1-9]\d*$/.test(s.reviewLine || "")) }))
        .child(this.menu("review-menu", this.button("review-trigger", "Review", cx, () => {}, { icon: "chevron", small: true }), () => this.menuSurface()
          .child(this.menuItem("approve-pr", "Approve", "", cx, cx => this.confirm(cx, "Approve this PR?", s.comment || pr.title, "review", { body: s.comment, verdict: "approve" }), { disabled: pr.state !== "OPEN" }))
          .child(this.menuItem("request-changes", "Request changes", "", cx, cx => this.confirm(cx, "Request changes?", s.comment, "review", { body: s.comment, verdict: "request-changes" }), { disabled: !s.comment.trim() || pr.state !== "OPEN" })))));
    if (s.replyTo || s.reviewPath) root.child(this.button("cancel-reply", "Cancel reply", cx, cx => { s.replyTo = null; s.reviewPath = null; cx.notify(); }, { small: true }));
    if (this.mode !== "pr") root.child(this.mergePanel(cx)); return root;
  }

  mergeResult(cx) {
    const request = this.s.mergeRequest;
    if (!request?.result?.details?.uuid) return;
    this.read(cx, "mergeResult", { number: request.number, uuid: request.result.details.uuid }, (result, state) => {
      if (state.mergeRequest === request) request.result = result;
    });
  }

  confirmMerge(cx, action, method) {
    const s = this.s, pr = s.github.pr, stack = s.github.mergeContext?.stack;
    const affected = action === "dequeue" && stack ? stack.pull_requests.slice(stack.position - 1).filter(item => item.state === "open") : stack?.scope;
    const scope = stack ? affected.map(item => `#${item.number} · ${item.head.ref}`).join("\n") : `#${pr.number} · ${pr.title}`;
    const title = action === "enqueue" ? "Add to merge queue?" : action === "dequeue" ? "Remove from merge queue?" : "Merge pull request stack?";
    const description = action === "dequeue" && stack ? `${scope}\n\nThis PR and the listed PRs above it will leave the queue.` : `${scope}\n\n${stack ? "Includes every open PR below this one in the stack. " : ""}GitHub checks repository rules before merging.`;
    this.confirm(cx, title, description, action, { method, stackHash: stack?.hash || null }, (state, result) => {
      if (action !== "dequeue") state.mergeRequest = { number: pr.number, result };
    });
  }

  mergePanel(cx) {
    const s = this.s, t = theme(), pr = s.github.pr, checks = pr.statusCheckRollup || [], root = v_flex().gap(8).pt(12).border_t(1).border_color(t.border);
    const failed = checks.filter(c => checkState(c) === "failure").length, pending = checks.filter(c => checkState(c) === "pending").length;
    const context = s.github.mergeContext, stack = context?.stack, queue = context?.queue;
    if (stack) root.child(v_flex().mb(6).border(1).border_color(t.border).rounded(5)
      .child(this.button("toggle-stack", `Stack #${stack.number} · ${stack.position} of ${stack.pull_requests.length} · ${stack.base.ref}`, cx, cx => {
        s.stackOpen = !s.stackOpen;
        if (s.stackOpen) this.read(cx, "stackDetails", { number: pr.number, prHead: pr.headRefOid }, (value, state) => { if (value) state.github.mergeContext.stack = value; });
        cx.notify();
      }, { small: true, navigation: true, icon: s.stackOpen ? "chevron" : "right" }).justify_start().truncate())
      .when(Boolean(s.stackOpen), e => e.children([...stack.pull_requests].reverse().map(item => {
        const status = item.merged_at ? "merged" : item.draft ? "draft" : item.checkState === "FAILURE" || item.checkState === "ERROR" ? "checks failed" : item.checkState === "PENDING" ? "checks pending" : (item.reviewDecision || item.state || "open").toLowerCase().replace(/_/g, " ");
        return this.button(`stack-pr-${item.number}`, "", cx, cx => {
          this.read(cx, "github", { number: item.number }, (github, state) => {
            if (state === this.s) openOverlay({ mod: "gitdeck", kind: "dialog", width: 0.9, height: 0.9,
              props: { mode: "pr", context: state.context, snapshot: { data: state.data, github, prRepository: state.prRepository, base: github.pr.baseRefName, prTab: "Conversation" } } });
          });
        }, { small: true, navigation: true, tip: `#${item.number} ${item.title || item.head.ref}` }).justify_start().bg(item.number === pr.number ? t.selected : "#00000000")
          .child(label(`#${item.number}`).text_size(11)).child(label(item.title || item.head.ref).flex_1().truncate().text_size(11)).child(label(status, t.dim).text_size(10));
      }))));
    if (context?.error) root.child(label(`Merge details unavailable: ${context.error.trim()}`, t.ansi3).text_size(11));
    const merge = s.mergeRequest?.number === pr.number ? s.mergeRequest.result : null;
    if (merge) root.child(h_flex().gap(4)
      .child(label(merge.status === "enqueued" ? "Added to merge queue; not yet merged" : merge.status === "merged" ? "Pull request merged" : merge.status === "failed" ? `Merge failed: ${merge.details?.message || "Refresh and retry"}` : "Merge request is processing…", merge.status === "failed" ? t.ansi1 : t.muted).flex_1())
      .when(merge.status === "pending", e => e.child(this.iconButton("refresh-merge-result", "refresh", "Refresh merge result", cx, cx => this.mergeResult(cx)))));
    root.child(label(failed ? `${failed} checks failed` : pending ? `${pending} checks in progress` : checks.length ? "All checks passed" : "No checks reported", failed ? t.ansi1 : pending ? t.ansi3 : t.muted))
      .child(label((pr.reviewDecision || "No reviews yet").toLowerCase().replace(/_/g, " "), t.muted));
    if (pr.state !== "OPEN") return root.child(label(pr.state === "MERGED" ? "Pull request merged" : "Pull request closed", t.muted));
    if (pr.isDraft) return root.child(this.button("ready-pr", "Ready for review", cx, cx => this.confirm(cx, "Mark ready for review?", pr.title, "readyPR"), { primary: true }));
    if (queue?.isInMergeQueue) return root
      .child(label(`In merge queue${queue.mergeQueueEntry?.position ? ` · #${queue.mergeQueueEntry.position}` : ""}${queue.mergeQueueEntry?.state ? ` · ${queue.mergeQueueEntry.state.toLowerCase().replace(/_/g, " ")}` : ""}`, t.ansi3))
      .child(this.button("leave-queue", "Remove from queue…", cx, cx => this.confirmMerge(cx, "dequeue"), { small: true, disabled: Boolean(context.error) }));
    if (queue?.isMergeQueueEnabled) return root.child(this.button("join-queue", stack ? `Queue ${stack.scope.length} pull requests` : "Add to merge queue", cx, cx => this.confirmMerge(cx, "enqueue"), { primary: true, disabled: Boolean(context.error) || pr.mergeable === "CONFLICTING" || merge?.status === "pending" }));
    const methods = [["squash", "squashMergeAllowed", "Squash and merge"], ["merge", "mergeCommitAllowed", "Create a merge commit"], ["rebase", "rebaseMergeAllowed", "Rebase and merge"]].filter(([, field]) => s.github.repository[field]);
    const selected = methods.find(([key]) => key === s.mergeMethod) || methods[0];
    if (!selected) return root;
    const [method, , methodTitle] = selected, title = stack ? `Merge ${stack.scope.length} pull requests` : methodTitle;
    root.child(h_flex().gap(2)
      .child(this.button(`merge-${method}`, title, cx, cx => stack ? this.confirmMerge(cx, "mergeStack", method) : this.confirm(cx, `${title}?`, `#${pr.number} · ${pr.title}`, "merge", { method }), { primary: true, disabled: pr.mergeable !== "MERGEABLE" || failed > 0 || pending > 0 || merge?.status === "pending" || Boolean(context?.error) }).flex_1())
      .child(this.menu("merge-methods", this.iconButton("merge-options", "chevron", "Merge options", cx, () => {}), () => this.menuSurface()
        .children(methods.map(([key, , name]) => this.menuItem(`method-${key}`, name, key === method ? "Selected" : "", cx, cx => { s.mergeMethod = key; cx.notify(); })))
        .child(this.menuItem("auto-merge", "Merge when ready…", "", cx, cx => this.confirm(cx, "Enable auto-merge?", title, "merge", { method, auto: true }), { disabled: Boolean(stack || context?.error) || pr.mergeable === "CONFLICTING" })))));
    if (pr.autoMergeRequest) root.child(this.button("disable-auto", "Disable auto-merge", cx, cx => this.confirm(cx, "Disable auto-merge?", pr.title, "disableAuto"), { small: true }));
    return root;
  }

  reactions(comment, reviewComment, cx) {
    const kinds = [["+1", "👍"], ["-1", "👎"], ["laugh", "😄"], ["confused", "😕"], ["heart", "❤️"], ["hooray", "🎉"], ["rocket", "🚀"], ["eyes", "👀"]];
    const id = `${reviewComment ? "review" : "issue"}-${comment.id}`;
    const react = (cx, content) => this.mutate(cx, "reaction", { commentId: comment.id, reviewComment, content });
    return h_flex().gap(3).flex_wrap()
      .children(kinds.filter(([content]) => comment.reactions?.[content] > 0).map(([content, emoji]) =>
        this.button(`reaction-${id}-${content}`, `${emoji} ${comment.reactions[content]}`, cx, cx => react(cx, content), { small: true, tip: `React with ${content}` })))
      .child(this.menu(`reactions-${id}`, this.iconButton(`add-reaction-${id}`, "smile", "Add reaction", cx, () => {}), () =>
        h_flex().w(220).p(5).gap(2).flex_wrap().rounded(6).bg(theme().raised).border(1).border_color(theme().border)
          .children(kinds.map(([content, emoji]) => this.button(`pick-reaction-${id}-${content}`, emoji, cx,
            cx => { this.s.menu = null; react(cx, content); }, { small: true, tip: `React with ${content}` })))));
  }

  checkIcon(check) {
    const t = theme(), status = checkPresentation(check);
    return this.icon(status.icon, status.kind === "success" ? t.ansi2 : status.kind === "failure" ? t.ansi1 : status.kind === "pending" ? t.ansi3 : t.dim);
  }

  loadCheck(cx, check, key) {
    const s = this.s; s.checkDetails[key] = { loading: true };
    this.read(cx, "checkDetails", { sha: s.github?.pr?.headRefOid || s.data.head, name: check.name || check.context, url: check.detailsUrl || check.targetUrl },
      (value, state) => { state.checkDetails[key] = value; }, `check-${key}`);
  }

  checkDetail(cx, check, key) {
    const s = this.s, t = theme(), detail = s.checkDetails[key];
    const content = v_flex().ml(26).mr(12).pl(12).py(6).gap(6).border_l(1).border_color(t.border);
    content.child(label(`Status: ${checkPresentation(check).label}`, t.dim).text_size(11));
    if (detail?.loading && s.loadingDetail) return content.child(label("Loading check details…", t.muted));
    if (!detail?.check) return content.child(this.button(`retry-check-${key}`, "Retry details", cx, cx => this.loadCheck(cx, check, key), { small: true, icon: "refresh" }));
    if (detail.check.output?.title) content.child(label(detail.check.output.title));
    if (detail.check.output?.summary) content.child(TextView.markdown(`check-summary-${key}`, detail.check.output.summary).text_size(11));
    if (detail.check.output?.text) content.child(TextView.markdown(`check-text-${key}`, detail.check.output.text).text_size(11));
    for (const [i, annotation] of detail.annotations.entries()) content.child(v_flex().gap(3).py(4)
      .child(label(`${annotation.path}:${annotation.start_line}`, t.muted).text_size(11))
      .child(label(annotation.message, annotation.annotation_level === "failure" ? t.ansi1 : t.muted).text_size(11)));
    if (detail.job) {
      for (const step of detail.job.steps || []) content.child(h_flex().gap(6).child(this.checkIcon(step)).child(label(step.name, t.muted).flex_1()).child(label(checkDuration(step), t.dim).text_size(10)));
      content.child(this.button(`check-log-${key}`, "View job log", cx, cx => this.read(cx, "log", { runId: detail.job.run_id, jobId: detail.job.id }, (value, state) => { state.log = value; state.logName = detail.job.name; }), { small: true }));
    }
    return content;
  }

  checks(cx) {
    const s = this.s, t = theme(), pr = s.github?.pr, root = v_flex().pb(12), checks = pr?.statusCheckRollup || [];
    const counts = {}, broken = checks.filter(c => checkPresentation(c).kind === "failure");
    for (const check of checks) { const kind = checkPresentation(check).kind; counts[kind] = (counts[kind] || 0) + 1; }
    const fix = cx => this.prepareAgent(cx, "Fix failing checks", [pr?.url || s.data?.branch,
      ...broken.map(c => `${c.name || c.context}: ${c.detailsUrl || c.targetUrl || ""}`), s.log || "Fetch the failing job logs with gh before making changes."].join("\n"));
    if (s.section === "Checks" && pr) root.child(v_flex().px(12).py(8).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(6).child(this.icon("pr"))
        .child(this.button("checks-pr", `#${pr.number}`, cx, cx => this.section(cx, "PR"), { small: true, navigation: true }))
        .child(label(pr.isDraft ? "DRAFT" : pr.state, t.dim).text_size(10)))
      .child(label(pr.title).font_weight(600)).child(label(`${pr.headRefName} → ${pr.baseRefName}`, t.dim).text_size(11)));
    if (pr?.mergeable === "CONFLICTING") root.child(h_flex().px(12).py(8).gap(8).border_b(1).border_color(t.border)
      .child(this.icon("branch", t.ansi3)).child(v_flex().flex_1().gap(3).child(label("Conflicts block this PR")).child(label("Resolve conflicts before merging.", t.dim).text_size(10)))
      .child(this.button("fix-conflicts", "Resolve", cx, cx => this.prepareAgent(cx, "Resolve merge conflicts", `${pr.url}\nCompare ${pr.headRefName} with ${pr.baseRefName}. Resolve conflicts without discarding either side's intent.`), { small: true, icon: "sparkles" })));
    if (broken.length) root.child(h_flex().px(12).py(8).gap(8).border_b(1).border_color(t.border)
      .child(this.icon("failed", t.ansi1))
      .child(v_flex().flex_1().gap(3).child(label(`${broken.length} failing ${broken.length === 1 ? "check" : "checks"}`)).child(label("Inspect details or start an AI fix.", t.dim).text_size(10)))
      .child(this.button("fix-checks", "Fix", cx, fix, { small: true, icon: "sparkles" })));
    const summary = [["success", "passing"], ["failure", "failing"], ["pending", "pending"], ["cancelled", "cancelled"], ["neutral", "skipped"]]
      .filter(([kind]) => counts[kind]).map(([kind, label]) => `${counts[kind]} ${label}`).join(" · ");
    root.child(this.button("checks-collapse", summary || (s.ghLoading ? "Loading checks…" : "No checks configured"), cx,
      cx => { s.collapsed.checks = !s.collapsed.checks; cx.notify(); }, { small: true, navigation: true, icon: s.collapsed.checks ? "right" : "chevron" })
      .justify_start().h(30).px(12).rounded(0).border_b(1).border_color(t.border).text_size(10).text_color(t.muted));
    if (!s.collapsed.checks) for (const [i, check] of [...checks].sort((a,b) => checkPresentation(a).order - checkPresentation(b).order).entries()) {
      const key = `${check.name || check.context}:${check.detailsUrl || check.targetUrl || ""}`, expanded = s.expandedChecks[key], url = check.detailsUrl || check.targetUrl;
      root.child(h_flex().id(`check-row-${i}`).h(31).px(12).gap(6).hover(e => e.bg(t.hover))
        .on_click((_event, cx) => { s.expandedChecks[key] = !expanded; if (!expanded) this.loadCheck(cx, check, key); cx.notify(); })
        .child(this.icon(expanded ? "chevron" : "right", t.dim)).child(this.checkIcon(check))
        .child(label(check.name || check.context).flex_1().min_w(0).truncate())
        .child(label(checkDuration(check), t.dim).text_size(10))
        .when(Boolean(url), e => e.child(this.iconButton(`check-${i}`, "external", "Open check on GitHub", cx, cx => cx.open_url(url)))));
      if (expanded) root.child(this.checkDetail(cx, check, key));
    }
    root.child(h_flex().px(8).mt(10).gap(4)
      .child(this.button("workflows-collapse", `WORKFLOWS ${s.runs.length}`, cx, cx => { s.collapsed.workflows = !s.collapsed.workflows; cx.notify(); }, { small: true, navigation: true, icon: s.collapsed.workflows ? "right" : "chevron" }).flex_1().justify_start().text_size(11).text_color(t.muted))
      .child(this.menu("workflow-actions", this.iconButton("workflow-more", "more", "Workflow actions", cx, () => {}), () => this.menuSurface()
        .child(this.menuItem("copy-failures", "Copy failed check context", "", cx, cx => cx.write_to_clipboard([pr?.url || s.data?.branch, ...broken.map(c => `${c.name || c.context}: ${c.detailsUrl || c.targetUrl || ""}`), s.log || ""].join("\n")))))));
    if (s.runError) root.child(label(s.runError, t.ansi1).px(12).py(6));
    if (!s.collapsed.workflows) for (const workflow of s.runs) {
      const id = workflow.databaseId, expanded = s.expandedRuns[id];
      const menu = () => this.menuSurface()
        .child(this.menuItem(`run-web-${id}`, "Open on GitHub", "", cx, cx => cx.open_url(workflow.url), { disabled: !workflow.url }))
        .child(this.menuItem(`rerun-${id}`, "Re-run all jobs…", "", cx, cx => this.confirm(cx, "Re-run workflow?", workflow.name, "rerun", { runId: id }), { disabled: workflow.status !== "completed" }))
        .child(this.menuItem(`failed-${id}`, "Re-run failed jobs…", "", cx, cx => this.confirm(cx, "Re-run failed jobs?", workflow.name, "rerun", { runId: id, failedOnly: true }), { disabled: checkPresentation(workflow).kind !== "failure" }))
        .child(this.menuItem(`cancel-${id}`, "Cancel workflow…", "", cx, cx => this.confirm(cx, "Cancel workflow?", workflow.name, "cancelRun", { runId: id }), { disabled: workflow.status === "completed" }));
      root.child(h_flex().id(`workflow-${id}`).px(12).h(31).gap(6).hover(e => e.bg(t.hover))
        .on_click((_event, cx) => { s.expandedRuns[id] = !expanded; if (!expanded) this.read(cx, "jobs", { runId: id }, (value, state) => { state.jobs[id] = value.jobs; }, `jobs-${id}`); cx.notify(); })
        .child(this.icon(expanded ? "chevron" : "right", t.dim)).child(this.checkIcon(workflow)).child(label(workflow.name).flex_1().min_w(0).truncate())
        .child(this.menu(`run-menu-${id}`, this.iconButton(`run-more-${id}`, "more", `${workflow.name} actions`, cx, () => {}), menu)));
      if (expanded) {
        const jobs = v_flex().ml(26).mr(12).pl(12).gap(4).py(4).border_l(1).border_color(t.border);
        jobs.child(label(`${checkPresentation(workflow).label} · ${(workflow.event || "").replace(/_/g, " ")} · ${short(workflow.headSha)}`, t.dim).text_size(10));
        if (!s.jobs[id]) jobs.child(label("Loading jobs…", t.muted));
        for (const job of s.jobs[id] || []) {
          jobs.child(h_flex().gap(5).child(this.checkIcon(job)).child(this.button(`job-${job.databaseId}`, job.name, cx,
            cx => this.read(cx, "log", { runId: id, jobId: job.databaseId }, (value, state) => { state.log = value; state.logName = job.name; }), { small: true, tip: "View job log" }).flex_1().justify_start().truncate()));
          for (const step of job.steps || []) jobs.child(h_flex().pl(18).gap(5).child(this.checkIcon(step)).child(label(step.name, t.muted).flex_1().min_w(0).truncate()).child(label(checkDuration(step), t.dim).text_size(10)));
        }
        root.child(jobs);
      }
    }
    if (s.log !== undefined) root.child(v_flex().p(12).gap(6).border_t(1).border_color(t.border)
      .child(h_flex().gap(4).child(label(s.logName).flex_1().truncate())
        .child(this.button("copy-log", "Copy", cx, cx => cx.write_to_clipboard(s.log), { small: true }))
        .child(this.iconButton("close-log", "close", "Close log", cx, cx => { s.log = undefined; cx.notify(); })))
      .child(div().h(300).overflow_y_scrollbar().overflow_x_scrollbar().children(s.log.split("\n").slice(-1000).map(line => label(line.slice(0, 1000), t.muted).font_family(settings().font_family).text_size(11))))
      .child(label("Last 1,000 lines · Copy includes the full returned log", t.dim).text_size(10)));
    return root;
  }

  readHistory(cx, limit = 100) {
    const query = (limit > 100 ? this.s.historySearch : this.s.historyQuery) || "";
    this.read(cx, "history", { limit, query }, (value, state) => {
      state.history = value; state.historyLimit = limit; state.historySearch = query;
      state.selectedCommit = null; state.commitFiles = [];
    });
  }

  history(cx) {
    const s = this.s, t = theme(), root = v_flex().p(10).gap(0);
    root.child(h_flex().gap(4).pb(8).child(this.input("historyQuery", 28))
      .child(this.iconButton("search-history", "search", "Search commit messages", cx, cx => this.readHistory(cx))))
      .child(label(`${s.historySearch ? "Matching" : "Recent"} commits · all local refs · ${s.history.length}`, t.muted).pb(6));
    if (s.selectedCommit) {
      root.child(label(s.selectedCommit.subject, t.accent))
        .child(h_flex().gap(5)
          .child(this.button("copy-sha", "Copy SHA", cx, cx => cx.write_to_clipboard(s.selectedCommit.hash), { small: true }))
          .child(this.button("cherry-pick", "Cherry-pick…", cx, cx => this.confirm(cx, "Cherry-pick commit?", s.selectedCommit.subject, "cherry-pick", { commit: s.selectedCommit.hash }), { small: true }))
          .child(this.button("revert", "Revert…", cx, cx => this.confirm(cx, "Revert commit?", "Creates a new commit reversing the selected change. Merge commits require a mainline and must be reverted in the terminal.", "revert", { commit: s.selectedCommit.hash }), { small: true })));
      for (const [i, file] of (s.commitFiles || []).entries()) root.child(this.fileRow(file, "commit", i, cx));
      if (s.selected?.layer === "commit") root.child(this.diffPreview(cx));
    }
    if (s.historyBranchCommit) root.child(v_flex().py(8).gap(5)
      .child(label(`New branch from ${short(s.historyBranchCommit.hash)}`, t.muted))
      .child(this.input("branchName"))
      .child(h_flex().gap(5)
        .child(this.button("create-history-branch", "Create branch", cx, cx => this.confirm(cx, "Create branch from commit?", `${s.branchName} at ${short(s.historyBranchCommit.hash)}`, "branchFromCommit", { branch: s.branchName, commit: s.historyBranchCommit.hash }, state => { state.historyBranchCommit = null; }), { small: true, disabled: !s.branchName?.trim() }))
        .child(this.button("cancel-history-branch", "Cancel", cx, cx => { s.historyBranchCommit = null; cx.notify(); }, { small: true }))));
    const graph = historyGraph(s.history).map(row => s.historySearch ? { ...row, lane: 0, lines: [], columns: 1 } : row), columns = Math.max(1, ...graph.map(row => row.columns));
    const colors = [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6];
    const color = lane => colors[lane % colors.length];
    for (const { commit, lane, lines } of graph) {
      const drawing = div().relative().w(14 * columns + 8).h(38).flex_none();
      for (const line of lines) drawing.child(window.paint_path(PathBuilder.stroke(1.5)
        .move_to(8 + line.from * 14, line.top).line_to(8 + line.to * 14, line.bottom).build(), color(line.to)).absolute().top(0).left(0).size_full());
      drawing.child(div().absolute().left(5 + lane * 14).top(16).size(6).rounded_full().bg(color(lane)));
      const id = `commit-menu-${commit.hash}`;
      const menu = () => this.menuSurface()
        .child(this.menuItem(`copy-hash-${commit.hash}`, "Copy commit hash", "", cx, cx => cx.write_to_clipboard(commit.hash)))
        .child(this.menuItem(`copy-message-${commit.hash}`, "Copy commit message", "", cx, cx => this.read(cx, "commitMessage", { commit: commit.hash }, value => cx.write_to_clipboard(value))))
        .child(this.menuItem(`checkout-${commit.hash}`, "Checkout commit…", "Detached HEAD", cx, cx => this.confirm(cx, "Checkout this commit?", "Switch to detached HEAD. Create a branch before making new commits.", "checkoutCommit", { commit: commit.hash })))
        .child(this.menuItem(`branch-${commit.hash}`, "Create branch from commit…", "", cx, cx => { s.historyBranchCommit = commit; s.branchName = ""; this.inputs.branchName.set_value(""); cx.notify(); }))
        .child(this.menuItem(`explain-${commit.hash}`, "Explain changes with AI…", "", cx, cx => this.prepareAgent(cx, "Explain commit", `Read commit ${commit.hash} and explain its changes. Do not modify files or Git history.`)))
        .child(this.menuItem(`cherry-${commit.hash}`, "Cherry-pick…", "", cx, cx => this.confirm(cx, "Cherry-pick commit?", commit.subject, "cherry-pick", { commit: commit.hash }), { disabled: commit.parents.length > 1 }))
        .child(this.menuItem(`revert-${commit.hash}`, "Revert…", "", cx, cx => this.confirm(cx, "Revert commit?", commit.subject, "revert", { commit: commit.hash }), { disabled: commit.parents.length > 1 }));
      const row = h_flex().id(`commit-${commit.hash}`).h(38).gap(5).min_w(0).hover(e => e.bg(t.hover))
        .bg(s.selectedCommit?.hash === commit.hash ? t.selected : "#00000000")
        .on_click((_event, cx) => { s.selectedCommit = commit; this.read(cx, "commitFiles", { commit: commit.hash }, (value, state) => { state.commitFiles = value; }); })
        .on_mouse_down("right", (_event, cx) => { s.menu = id; cx.notify(); })
        .child(drawing)
        .child(v_flex().flex_1().min_w(0).gap(2).child(label(commit.subject).truncate())
          .child(label(`${short(commit.hash)} · ${commit.author} · ${commit.date.slice(0, 10)}${commit.refs ? ` · ${commit.refs}` : ""}`, t.dim).text_size(10).truncate().tooltip(commit.refs || commit.hash)));
      root.child(Popup.new(id, row).anchor("bottom_left").when(s.menu === id, e => e.content(menu().on_mouse_down_out((_event, cx) => { s.menu = null; cx.notify(); }))));
    }
    if (s.history.length === (s.historyLimit || 100) && s.history.length < 2000) root.child(
      this.button("more-history", "Load 100 more commits", cx, cx => this.readHistory(cx, (s.historyLimit || 100) + 100), { small: true, disabled: s.loadingDetail === "history" }).mt(8));
    return root;
  }

  generateButton(cx, purpose) {
    const active = this.s.generation?.purpose === purpose;
    return this.iconButton(`generate-${purpose}`, active ? "close" : "sparkles", active ? "Cancel generation" : `Generate with ${this.s.aiProvider}; sends the diff to your authenticated agent`, cx,
      cx => active ? this.cancelGeneration(cx) : this.generate(cx, purpose), { disabled: Boolean(this.s.generation && !active) || (purpose === "pr" && this.prOutsideCheckout()) });
  }

  generate(cx, purpose) {
    const s = this.s;
    if (s.generation || !s.data || (purpose === "pr" && this.prOutsideCheckout())) return;
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const job = { purpose, head: s.data.head, index: s.data.index, before: { message: s.message, title: s.title, body: s.body }, cancelFile: `${appHome()}/data/gitdeck-ai-cancel-${nonce}` };
    s.generation = job; s.generationError = "";
    cx.spawn(async cx => {
      try {
        const result = await this.request(s, "generate", { purpose, base: s.base, provider: s.aiProvider, model: s.aiModel, effort: s.aiEffort, instruction: s.aiInstructions, cancelFile: job.cancelFile });
        if (s.generation !== job) return;
        if (s.data.head !== job.head || s.data.index !== job.index) throw new Error("Changes moved while generating. Review them and generate again.");
        if (Object.keys(result).some(key => s[key] !== job.before[key])) s.generatedSuggestion = result;
        else this.applyGenerated(cx, s, result);
      } catch (error) { if (s.generation === job) s.generationError = String(error.message || error); }
      finally { if (s.generation === job) s.generation = null; cx.notify(); }
    }); cx.notify();
  }

  applyGenerated(cx, s, result) {
    for (const [key, value] of Object.entries(result)) {
      s[key] = value; if (this.s === s) this.inputs[key].set_value(value);
    }
    s.generatedSuggestion = null; this.saveDraft(cx); cx.notify();
  }

  cancelGeneration(cx) {
    const s = this.s, job = s.generation;
    if (!job) return;
    s.generation = null;
    cx.spawn(async cx => {
      try { await writeTextFile(job.cancelFile, "cancel", null); }
      catch (error) { s.generationError = `Could not stop the agent: ${error.message}`; }
      cx.notify();
    }); cx.notify();
  }

  aiSettings(cx) {
    const s = this.s, t = theme();
    return v_flex().p(12).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().child(label("AI writing settings").font_weight(600)).child(div().flex_1())
        .child(this.iconButton("close-ai-settings", "close", "Close AI settings", cx, cx => { s.aiSettings = false; this.saveDraft(cx); cx.notify(); })))
      .child(label("Uses your local CLI account when you generate.", t.muted).text_size(11))
      .child(h_flex().gap(4).children(["codex", "claude"].map(provider => this.button(`provider-${provider}`, provider === "codex" ? "Codex" : "Claude", cx,
        cx => { s.aiProvider = provider; this.saveDraft(cx); cx.notify(); }, { small: true, primary: s.aiProvider === provider }))))
      .child(label("Model", t.muted)).child(this.input("aiModel"))
      .child(label("Reasoning effort", t.muted))
      .child(h_flex().gap(3).children(["low", "medium", "high", "xhigh"].map(effort => this.button(`effort-${effort}`, effort, cx,
        cx => { s.aiEffort = effort; this.saveDraft(cx); cx.notify(); }, { small: true, primary: s.aiEffort === effort }))))
      .child(label("Writing instructions", t.muted)).child(this.input("aiInstructions", 90));
  }

  prepareNotes(cx, notes) {
    const s = this.s;
    this.prepareAgent(cx, "Address review notes", formatNotes(notes));
    const task = s.agentTask; task.notes = [...notes]; task.targetsLoading = true;
    cx.spawn(async cx => {
      try { task.targets = await this.request(s, "noteTargets"); }
      catch (error) { task.targetsError = String(error.message || error); }
      finally { task.targetsLoading = false; cx.notify(); }
    });
  }

  sendNotes(cx, target) {
    const s = this.s, task = s.agentTask;
    if (!task?.notes || task.delivered) return;
    this.confirm(cx, `Send notes to ${target.title}?`, s.agentPrompt, "sendNotes", { body: s.agentPrompt, target }, (state, result) => {
      if (!result.delivered) return;
      task.delivered = true;
      if (state.agentTask === task) state.agentTask = null;
      state.notice = `Notes delivered to ${target.title} (${result.address}).`;
      if (state.notesLoading || state.notesBusy) state.notesError = "Delivery succeeded; notes remain saved because another note operation is running.";
      else this.updateNotes(cx, { before: task.notes }, undefined, state);
    });
  }

  prepareAgent(cx, title, details) {
    const s = this.s;
    const task = s.agentTask = { title, context: { ...s.context }, loading: true, agents: [] };
    s.agentPrompt = `${title} in this repository.\n\n${details}\n\nInvestigate the root cause and make a focused fix. Run relevant checks. Do not bypass hooks or checks, commit, push, or merge without my instruction.`;
    this.inputs.agentPrompt.set_value(s.agentPrompt);
    cx.spawn(async cx => {
      try {
        const agents = await knownAgents();
        if (s.agentTask === task) task.agents = agents.filter(agent => agent.installed);
      } catch (error) { s.actionError = String(error.message || error); }
      finally { task.loading = false; cx.notify(); }
    }); cx.notify();
  }

  launchAgent(cx, agent) {
    const s = this.s, task = s.agentTask;
    if (!task || !s.agentPrompt.trim()) return;
    try {
      run("tab.new", { name: task.title, space: task.context.scope?.split("/")[0], folder: task.context.cwd, argv: agent.run, task: s.agentPrompt, focus: true });
      s.agentTask = null; s.notice = `Opened ${agent.label || agent.name || "agent"} with the selected task.`;
    } catch (error) { s.actionError = String(error.message || error); }
    cx.notify();
  }

  feedback(cx) {
    const s = this.s, t = theme(), root = v_flex().gap(5);
    if (s.aiSettings) root.child(this.aiSettings(cx));
    if (s.generation) root.child(h_flex().p(8).gap(5).child(this.icon("sparkles")).child(label(s.generation.purpose === "commit" ? "Generating commit message…" : "Generating title and description…", t.muted)));
    if (s.generationError) root.child(label(s.generationError, t.ansi1).p(8));
    if (s.generatedSuggestion) root.child(v_flex().p(10).gap(6).border(1).border_color(t.border)
      .child(label("Your draft changed while generating.", t.muted))
      .child(TextView.markdown("generated-suggestion", Object.values(s.generatedSuggestion).join("\n\n")).text_size(12).max_h(180).overflow_y_scrollbar())
      .child(h_flex().gap(4)
        .child(this.button("use-generated", "Use generated text", cx, cx => this.applyGenerated(cx, s, s.generatedSuggestion), { small: true }))
        .child(this.button("discard-generated", "Keep my draft", cx, cx => { s.generatedSuggestion = null; cx.notify(); }, { small: true }))));
    if (s.busy || s.loadingDetail) root.child(label(`Working: ${s.busy || s.loadingDetail}…`, t.accent).p(8));
    if (s.draftError) root.child(label(s.draftError, t.ansi3).p(8));
    if (s.error) root.child(div().p(8).max_h(150).overflow_y_scrollbar().text_size(12).text_color(t.ansi1).child(s.error));
    if (s.actionError) root.child(v_flex().p(8).gap(5)
      .child(div().max_h(150).overflow_y_scrollbar().text_size(12).text_color(t.ansi1).child(s.actionError))
      .child(this.button("fix-operation", "Fix with AI…", cx, cx => this.prepareAgent(cx, "Fix Git operation", s.actionError), { small: true }))
      .child(this.button("dismiss-error", "Dismiss error", cx, cx => { s.actionError = ""; cx.notify(); }, { small: true })));
    if (s.notice) root.child(div().p(8).max_h(80).overflow_y_scrollbar().text_size(11).text_color(t.done).child(s.notice));
    if (s.agentTask) root.child(v_flex().p(10).gap(6).border(1).border_color(t.border)
      .child(h_flex().child(label(s.agentTask.title)).child(div().flex_1()).child(this.iconButton("cancel-agent", "close", "Cancel agent task", cx, cx => { s.agentTask = null; cx.notify(); })))
      .child(this.input("agentPrompt", 130))
      .when(Boolean(s.agentTask.notes), e => e.child(label(s.agentTask.targetsLoading ? "Finding agents in this repository…" : "Send to an existing agent", t.muted))
        .when(Boolean(s.agentTask.targetsError), el => el.child(label(s.agentTask.targetsError, t.ansi1)))
        .when(!s.agentTask.targetsLoading && !s.agentTask.targets?.length, el => el.child(label("No ready agents in this repository", t.dim)))
        .children((s.agentTask.targets || []).map((target, i) => this.button(`send-notes-${i}`, `${target.title} · ${target.address} · ${target.state}`, cx, cx => this.sendNotes(cx, target), { small: true, disabled: !s.agentPrompt.trim() }))))
      .child(label(s.agentTask.loading ? "Finding installed agents…" : s.agentTask.agents.length ? "Open with" : "No installed agents found in Herdr", t.muted))
      .children(s.agentTask.agents.map((agent, i) => this.button(`launch-agent-${i}`, agent.label || agent.name || agent.run[0], cx, cx => this.launchAgent(cx, agent), { small: true }))));
    if (s.confirm) {
      const pending = s.confirm;
      root.child(v_flex().p(10).gap(8).bg(t.raised).border(1).border_color(t.accent)
        .child(label(pending.title, t.accent)).child(div().max_h(100).overflow_y_scrollbar().text_size(12).child(pending.description))
        .child(h_flex().gap(6)
          .child(this.button("confirm-operation", "Confirm", cx, cx => this.mutate(cx, pending.action, pending.args, pending.done), { primary: true }))
          .child(this.button("cancel-operation", "Cancel", cx, cx => { s.confirm = null; cx.notify(); }))));
    }
    return root;
  }

  header(cx) {
    const s = this.s, t = theme(), d = s.data, pr = s.github?.pr, stats = sum(d?.comparison || []);
    const branches = () => this.menuSurface().child(this.input("branchName"))
      .child(div().max_h(230).overflow_y_scrollbar().children((d?.branches || []).filter(b => !s.branchName || b.toLowerCase().includes(s.branchName.toLowerCase())).slice(0, 60).map((branch, i) =>
        this.menuItem(`branch-${i}`, branch, branch === d.branch ? "Current" : "", cx, cx => this.confirm(cx, "Switch branch?", branch, "switch", { branch }), { disabled: branch === d.branch }))))
      .child(this.menuItem("create-branch", "Create branch…", s.branchName, cx, cx => this.mutate(cx, "branch", { branch: s.branchName }), { disabled: !s.branchName }));
    const base = () => this.menuSurface().child(this.input("base"))
      .child(this.menuItem("set-base", "Compare with this ref", "", cx, cx => this.refresh(cx)))
      .children((d?.branches || []).filter(b => b !== d.branch).slice(0, 30).map((branch, i) => this.menuItem(`base-${i}`, branch, "", cx, cx => { s.base = branch; this.inputs.base.set_value(branch); this.refresh(cx); })));
    const overflow = () => this.menuSurface()
      .child(this.menuItem("view-tree", "View as tree", s.tree ? "On" : "Off", cx, cx => { s.tree = !s.tree; cx.notify(); }))
      .child(this.menuItem("ai-settings", "AI writing settings", "", cx, cx => { s.aiSettings = true; cx.notify(); }))
      .child(this.menuItem("history", "Git history", "", cx, cx => this.section(cx, "History")))
      .child(this.menuItem("refresh-menu", "Refresh", "R", cx, cx => { this.refresh(cx); this.github(cx); }))
      .child(this.menuItem("link-review", "Link pull request…", "", cx, cx => { s.section = "PR"; s.linkPR = true; cx.notify(); }))
      .child(this.menuItem("hide", "Hide sidebar", "⌘ ⇧ G", cx, () => run("layout.hide", { id: "panel" })));
    return v_flex().px(8).pt(5).pb(4).gap(2)
      .child(h_flex().gap(2).min_w(0)
        .when(s.section !== "Changes", e => e.child(this.iconButton("back-changes", "back", "Back to changes", cx, cx => this.section(cx, "Changes"))))
        .child(div().flex_1().min_w(0).child(s.section === "Changes"
          ? this.menu("branch-picker", this.button("branches", d?.branch || (d?.head ? short(d.head) : "Source control"), cx, () => {}, { small: true, navigation: true, icon: "branch" }).max_w(230).truncate(), branches)
          : label(s.section === "PR" ? "Pull request" : s.section === "History" ? "Git history" : "Checks").font_weight(600)))
        .child(this.iconButton("filter", "search", "Filter files (/)", cx, cx => { s.filterOpen = !s.filterOpen; if (s.filterOpen) this.inputs.query.focus(); else { s.query = ""; this.inputs.query.set_value(""); } cx.notify(); }))
        .child(this.iconButton("refresh", "refresh", s.loading || s.ghLoading ? "Refreshing…" : "Refresh", cx, cx => { this.refresh(cx); this.github(cx); }, { disabled: s.loading || s.ghLoading }))
        .child(this.menu("view-actions", this.iconButton("more", "more", "More actions", cx, () => {}), overflow)))
      .when(s.section === "Changes", e => e.child(h_flex().pl(6).gap(3).min_w(0)
        .child(this.icon("right"))
        .child(this.menu("base-picker", this.button("base-picker-trigger", s.base || "Select base", cx, () => {}, { small: true, navigation: true }).max_w(150).truncate(), base))
        .child(div().flex_1())
        .child(label(`+${stats.add}`, t.ansi2).text_size(11)).child(label(`−${stats.del}`, t.ansi1).text_size(11))))
      .when(s.section === "Changes" && Boolean(pr || s.github), e => e.child(h_flex().pl(5).gap(3)
        .child(this.button("go-pr", pr ? `#${pr.number} ${pr.title}` : "Create pull request", cx, cx => pr ? this.section(cx, "PR") : this.beginPR(cx), { small: true, navigation: true, icon: "pr" }).flex_1().justify_start().truncate())
        .when(Boolean(pr), e => e.child(this.iconButton("go-checks", "check", "Checks and reviews", cx, cx => this.section(cx, "Checks"))))))
      .when(s.filterOpen, e => e.child(h_flex().gap(3).py(3).child(this.input("query", 26)).child(this.iconButton("clear-filter", "close", "Close filter", cx, cx => { s.filterOpen = false; s.query = ""; this.inputs.query.set_value(""); cx.notify(); }))));
  }

  render(cx) {
    if (!checking()) this.sync(cx);
    const s = this.s, t = theme(), data = s.data;
    if (this.mode === "launcher") return v_flex().size_full().bg(t.surface).text_color(t.foreground).p(16).gap(8)
      .child(label("Gitdeck sidebar is not installed in this layout."))
      .child(label("Run the included install.mjs to connect the Changes panel.", t.muted));
    if (this.mode === "diff") return this.diffView(cx);
    if (this.mode === "conflict") return this.conflictView(cx);
    if (this.mode === "pr") return v_flex().size_full().min_h(0).bg(t.surface).text_color(t.foreground)
      .child(h_flex().h(32).px(10).gap(4).child(label("Pull request", t.muted).flex_1())
        .child(this.iconButton("refresh-pr-detail", "refresh", "Refresh pull request", cx, cx => this.github(cx)))
        .child(this.iconButton("close-pr-detail", "close", "Close pull request", cx, () => closeOverlay(props().overlay))))
      .child(this.feedback(cx)).when(Boolean(s.ghError), e => e.child(label(s.ghError, t.ansi1).p(8)))
      .child(this.prView(cx));
    return v_flex().id("gitdeck-root").size_full().min_w(0).bg(t.surface).text_color(t.foreground).track_focus(this.focus)
      .on_size_change((size, cx) => { this.width = size.width; this.height = size.height; cx.notify(); })
      .on_key_down((event, cx) => {
        if (event.keystroke === "cmd-enter") { cx.stop_propagation(); this.commit(cx); }
        else if (event.key === "escape") { s.menu = null; s.filterOpen = false; s.fileSelection = []; s.fileAnchor = null; cx.notify(); }
        else if (!this.typing && event.keystroke === "cmd-a" && s.section === "Changes") { s.fileSelection = selectableFiles(s).map(entry => entry.key); cx.stop_propagation(); cx.notify(); }
        else if (!this.typing && event.key === "r") { this.refresh(cx); this.github(cx); }
        else if (!this.typing && event.key === "/") { s.filterOpen = true; this.inputs.query.focus(); cx.notify(); cx.stop_propagation(); }
        else if (!this.typing && ["j", "k"].includes(event.key) && data?.files.length) {
          const files = data.files.filter(f => f.path.toLowerCase().includes(s.query.toLowerCase()));
          const index = files.findIndex(f => f.path === s.selected?.path), next = Math.max(0, Math.min(files.length - 1, index + (event.key === "j" ? 1 : -1)));
          if (files[next]) this.pick(cx, files[next], files[next].unstaged ? "unstaged" : "staged"); cx.stop_propagation();
        } else if (!this.typing && event.key === "enter" && s.selected) this.showDiff(cx);
      })
      .child(this.header(cx))
      .child(this.feedback(cx))
      .when(Boolean(s.ghError), e => e.child(div().p(8).text_size(11).text_color(t.ansi1).child(`${s.ghError} · Refresh to retry.`)))
      .child(s.section === "Changes" ? this.changes(cx) : v_flex().id(`section-${s.section}`).flex_1().min_h(0).overflow_y_scrollbar()
        .child(s.section === "PR" ? this.prView(cx) : s.section === "Checks" ? this.checks(cx) : this.history(cx)));
  }
}
