// Alt-s, then a key from config.json. Persistent entries reuse their session;
// ephemeral entries end when selected from inside their popup. Esc closes this menu.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, home, appHome, readTextFile, props, focused, spaces, terminals, openOverlay, closeOverlay, run, notify, theme } from "herdr";

// Shared by the menu and guard copies; contains only currently open overlays.
const floating = new Map();
const suspended = new Map();

function parseConfig(text) {
  if (text === null) throw new Error("mods/floatterm/config.json is missing");
  const entries = JSON.parse(text);
  if (!Array.isArray(entries)) throw new Error("config.json must contain an array");
  const ids = new Set();
  const keys = new Set();
  return entries.map((p, index) => {
    const fail = (message) => { throw new Error(`Entry ${index + 1}: ${message}`); };
    if (!p || typeof p !== "object" || Array.isArray(p)) fail("expected an object");
    for (const field of ["id", "key"]) {
      if (typeof p[field] !== "string" || !p[field].trim()) fail(`${field} is required`);
    }
    if (ids.has(p.id)) fail(`duplicate id: ${p.id}`);
    if (keys.has(p.key)) fail(`duplicate key: ${p.key}`);
    for (const field of ["name", "command", "cwd"]) {
      if (p[field] !== undefined && (typeof p[field] !== "string" || !p[field].trim())) {
        fail(`${field} must be a non-empty string`);
      }
    }
    if (p.session !== undefined && !["ephemeral", "persistent"].includes(p.session)) {
      fail("session must be ephemeral or persistent");
    }
    if (p.scope !== undefined && !["tab", "space", "global"].includes(p.scope)) {
      fail("scope must be tab, space or global");
    }
    ids.add(p.id);
    keys.add(p.key);
    return { ...p, name: p.name ?? p.id, scope: p.scope ?? "tab", keep: p.session === "persistent" };
  });
}

function directory(cwd, current) {
  if (!cwd) return current;
  if (cwd === "~") return home();
  if (cwd.startsWith("~/")) return home() + cwd.slice(1);
  return cwd.startsWith("/") ? cwd : `${current}/${cwd}`;
}

function scopeKey(p, context) {
  if (p.scope === "global") return "global";
  if (!context?.space || (p.scope === "tab" && !context.tab)) return null;
  return p.scope === "space" ? `space:${context.space}` : `tab:${context.space}:${context.tab}`;
}

function sameTab(a, b) {
  return a?.space === b?.space && a?.tab === b?.tab;
}

// Unscoped terminals from earlier versions remain accessible with scope: global.
function liveTerminal(p, context) {
  const scope = scopeKey(p, context);
  return terminals().find((t) => t.labels?.popup === p.id && t.state === "live"
    && (t.labels["floatterm.scope"] ?? "global") === scope);
}

function showTerminal(p, terminal, context) {
  suspended.delete(terminal);
  const previous = floating.get(terminal);
  if (previous) closeOverlay(previous.overlay);
  const overlay = openOverlay({
    kind: "dialog", width: 0.8, height: 0.8,
    layout: { type: "column", children: [
      { type: "block", size: { px: 0 }, content: { mod: "floatterm", props: { scopeGuard: { scope: p.scope, context, terminal } } } },
      { type: "block", size: { px: 34 }, content: { mod: "peek", props: { terminal } } },
      { type: "block", content: { terminal } },
    ] },
  });
  floating.set(terminal, { overlay, scope: p.scope, context });
}

function restoreSuspended() {
  const current = focused();
  // Closing the previous tab's overlay restores pane focus. Let that finish
  // before opening this tab's popup, so it keeps the keyboard.
  if ([...floating.values()].some(saved => scopeKey(saved, current) !== scopeKey(saved, saved.context))) return;
  const available = spaces();
  const live = terminals();
  for (const [terminal, saved] of suspended) {
    const owner = available.find(s => s.id === saved.context.space);
    if (!owner || (saved.scope === "tab" && !owner.tabs.some(t => t.id === saved.context.tab))
      || !live.some(t => t.address === terminal && t.state === "live")) {
      suspended.delete(terminal);
    } else if (scopeKey(saved, current) === scopeKey(saved, saved.context)) {
      showTerminal(saved, terminal, saved.context);
    }
  }
}

// A peek fails until the app has heard of the new terminal: wait for it (at most 3 s).
function whenKnown(cx, address) {
  return new Promise((resolve) => {
    let waited = 0;
    const task = cx.timer.every(50, () => {
      waited += 50;
      if (waited >= 3000 || terminals().some((t) => t.address === address && t.state === "live")) {
        task.cancel();
        resolve();
      }
    });
  });
}

// What to do once this menu is closed: { peek: address }, { hide: true }, or null.
// `from` is the terminal that had the keyboard when the menu opened.
async function toggle(cx, p, from, current, context) {
  const scope = scopeKey(p, context);
  if (scope === null) throw new Error(`Open a ${p.scope} before launching this terminal`);
  const open = liveTerminal(p, context);
  if (open) {
    if (open.address !== from) return { peek: open.address };
    if (p.keep) return { hide: true };
    const r = await hc(["kill", open.address]);
    // --rm can delete the terminal before hc reads its result: exit 3 = not_found.
    if (r.code !== 0 && r.code !== 3) throw new Error(r.stderr.trim() || `hc kill exited ${r.code}`);
    return null;
  }

  // Load .zshrc (mise, kube/aws setup) for commands as well as interactive shells.
  const argv = p.command === undefined ? ["/bin/zsh", "-l"] : ["/bin/zsh", "-lic", p.command];

  const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--no-notify", ...(p.keep ? ["--keep"] : []),
    "--label", `popup=${p.id}`, "--label", `floatterm.scope=${scope}`,
    "--cwd", directory(p.cwd, current), "--", ...argv]);
  const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
  if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || `hc run exited ${r.code}`);
  await whenKnown(cx, address);
  return { peek: address };
}

export default class Floatterm extends View {
  init(_props, cx) {
    this.restorer = props()?.restorer;
    if (this.restorer) return;
    this.overlay = props()?.overlay;
    this.guard = props()?.scopeGuard;
    if (this.guard) {
      floating.set(this.guard.terminal, { ...this.guard, overlay: this.overlay });
      return;
    }
    const f = focused(); // read before this menu takes the keyboard
    this.context = f;
    const space = spaces().find((s) => s.id === f?.space);
    this.from = f?.terminal ?? null;
    this.current = space && !space.machine && f?.cwd ? f.cwd : home();
    this.programs = [];
    this.message = "Loading…";
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Opened by a key, the window can hand the keyboard back to the pane: take it again.
    cx.timer.after(150, () => this.handle.focus());
    cx.spawn(async (cx) => {
      try {
        this.programs = parseConfig(await readTextFile(`${appHome()}/mods/floatterm/config.json`));
        this.message = this.programs.length ? null : "No entries in config.json";
      } catch (e) {
        this.message = `config.json: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  pick(p, cx) {
    // `herdr-app check` has no overlay: start nothing there.
    if (this.busy || !this.overlay) return;
    this.busy = true;
    const overlay = this.overlay;
    cx.spawn(async (cx) => {
      let next = null;
      try {
        next = await toggle(cx, p, this.from, this.current, this.context);
      } catch (e) {
        notify({ title: `${p.name} floating terminal failed`, body: String(e?.message ?? e), level: "error" });
      }
      this.done = true;
      // Close this menu first: closing it gives the keyboard back to the pane below,
      // so the peek has to open after that to keep it, and the one to hide is then on top.
      closeOverlay(overlay);
      // A slow launch belongs to the original tab, even if the user has moved on.
      if (!sameTab(this.context, focused())) return;
      if (next?.hide) run("overlay.close");
      else if (next?.peek) showTerminal(p, next.peek, this.context);
    });
  }

  // Dismissed (Esc, alt-s) over one of these popups: the keyboard went to the pane
  // below, so give it back to the popup that's still showing.
  async close() {
    if (this.guard) {
      if (floating.get(this.guard.terminal)?.overlay === this.overlay) {
        floating.delete(this.guard.terminal);
        if (scopeKey(this.guard, focused()) !== scopeKey(this.guard, this.guard.context)) {
          suspended.set(this.guard.terminal, this.guard);
        } else if (!this.suspended) suspended.delete(this.guard.terminal);
      }
      return;
    }
    if (this.done || !this.from || !sameTab(this.context, focused())) return;
    if (terminals().some((t) => t.address === this.from && t.labels?.popup && t.state === "live")) {
      const previous = floating.get(this.from);
      if (previous) showTerminal(previous, this.from, previous.context);
      else run("terminal.peek", { terminal: this.from });
    }
  }

  render(cx) {
    if (this.restorer) {
      // This zero-height layout block stays alive while popups are hidden.
      // Read live data even with no pending popup so Herdr tracks dependencies.
      focused();
      spaces();
      terminals();
      if (suspended.size && !this.restoreQueued) {
        this.restoreQueued = true;
        cx.timer.after(0, () => {
          this.restoreQueued = false;
          restoreSuspended();
        });
      }
      return div().size_full();
    }
    if (this.guard) {
      if (!this.closing && scopeKey(this.guard, focused()) !== scopeKey(this.guard, this.guard.context)) {
        this.closing = true;
        // React to navigation, then close after this render has finished.
        cx.timer.after(0, (cx) => {
          if (scopeKey(this.guard, focused()) === scopeKey(this.guard, this.guard.context)) {
            this.closing = false;
            return;
          }
          if (floating.get(this.guard.terminal)?.overlay !== this.overlay) return;
          this.suspended = true;
          suspended.set(this.guard.terminal, this.guard);
          closeOverlay(this.overlay);
        });
      }
      return div().size_full();
    }
    const t = theme();
    return v_flex()
      .id("floatterm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // By the key's own letter, not what it types: works with Korean input too.
        const p = this.programs.find((p) => p.key === e.keystroke);
        if (p) this.pick(p, cx);
      })
      .size_full()
      .overflow_y_scrollbar()
      .p(6)
      .gap(2)
      .text_size(13)
      .when(Boolean(this.message), (el) => el.child(div().text_color(t.muted).child(this.message)))
      .children(
        this.programs.map((p) =>
          h_flex()
            .id(`floatterm-${p.key}`)
            .h(28)
            .flex_none()
            .px(8)
            .gap(10)
            .items_center()
            .rounded(4)
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.pick(p, cx))
            .child(div().min_w(14).font_semibold().text_color(t.accent).child(p.key))
            .child(div().flex_1().truncate().text_color(t.foreground).child(p.name))
            .when(Boolean(liveTerminal(p, this.context)), (el) =>
              el.child(div().text_size(12).text_color(t.muted).child(
                p.keep ? "running: shows/hides" : liveTerminal(p, this.context)?.address === this.from ? "open: ends it" : "running: shows"))),
        ),
      );
  }
}
