// alt-s, then a key: that program in a peek over the tab, like herdr TUI's
// [[keys.command]] type = "popup" (prefix+alt+<key>). The same key again while its popup
// is open ends it; a `keep` one (scratch) is hidden instead, from inside it, and shown
// again from anywhere else, same session. Esc (or alt-s again) closes this menu.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, home, props, focused, spaces, terminals, closeOverlay, run, notify, theme } from "herdr";

// Started through an interactive login shell so .zshrc (mise, kube/aws setup) applies.
const PROGRAMS = [
  { key: "s", name: "scratch", argv: ["/bin/zsh", "-l"], keep: true },
  { key: "f", name: "zsh", argv: ["/bin/zsh", "-l"] },
  { key: "g", name: "lazygit", argv: ["/bin/zsh", "-lic", "exec lazygit"] },
  { key: "k", name: "k9s", argv: ["/bin/zsh", "-lic", "exec k9s"] },
  { key: "t", name: "pug", argv: ["/bin/zsh", "-lic", "exec pug"] },
];

function liveTerminal(p) {
  return terminals().find((t) => t.labels?.popup === p.name && t.state === "live");
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
async function toggle(cx, p, from) {
  const open = liveTerminal(p);
  if (open && p.keep) return open.address === from ? { hide: true } : { peek: open.address };
  if (open) {
    await hc(["kill", open.address]);
    return null;
  }

  // Start where the focused terminal is, when that's on this computer.
  const f = focused();
  const space = spaces().find((s) => s.id === f?.space);
  const cwd = space && !space.machine && f?.cwd ? f.cwd : home();

  const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--no-notify", ...(p.keep ? ["--keep"] : []),
    "--label", `popup=${p.name}`, "--cwd", cwd, "--", ...p.argv]);
  const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
  if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || `hc run exited ${r.code}`);
  await whenKnown(cx, address);
  return { peek: address };
}

export default class Popup extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay;
    this.from = focused()?.terminal ?? null; // read before this menu takes the keyboard
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Opened by a key, the window can hand the keyboard back to the pane: take it again.
    cx.timer.after(150, () => this.handle.focus());
  }

  pick(p, cx) {
    // `herdr-app check` has no overlay: start nothing there.
    if (this.busy || !this.overlay) return;
    this.busy = true;
    const overlay = this.overlay;
    cx.spawn(async (cx) => {
      let next = null;
      try {
        next = await toggle(cx, p, this.from);
      } catch (e) {
        notify({ title: `${p.name} popup failed`, body: String(e?.message ?? e), level: "error" });
      }
      this.done = true;
      // Close this menu first: closing it gives the keyboard back to the pane below,
      // so the peek has to open after that to keep it, and the one to hide is then on top.
      closeOverlay(overlay);
      if (next?.hide) run("overlay.close");
      else if (next?.peek) run("terminal.peek", { terminal: next.peek });
    });
  }

  // Dismissed (Esc, alt-s) over one of these popups: the keyboard went to the pane
  // below, so give it back to the popup that's still showing.
  async close() {
    if (this.done || !this.from) return;
    if (terminals().some((t) => t.address === this.from && t.labels?.popup && t.state === "live")) {
      run("terminal.peek", { terminal: this.from });
    }
  }

  render() {
    const t = theme();
    return v_flex()
      .id("popup")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // By the key's own letter, not what it types: works with Korean input too.
        const p = PROGRAMS.find((p) => p.key === e.key);
        if (p) this.pick(p, cx);
      })
      .size_full()
      .p(6)
      .gap(2)
      .text_size(13)
      .children(
        PROGRAMS.map((p) =>
          h_flex()
            .id(`popup-${p.key}`)
            .h(28)
            .px(8)
            .gap(10)
            .items_center()
            .rounded(4)
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.pick(p, cx))
            .child(div().w(14).font_semibold().text_color(t.accent).child(p.key))
            .child(div().flex_1().text_color(t.foreground).child(p.name))
            .when(Boolean(liveTerminal(p)), (el) =>
              el.child(div().text_size(12).text_color(t.muted).child(p.keep ? "running: shows/hides" : "open: ends it"))),
        ),
      );
  }
}
