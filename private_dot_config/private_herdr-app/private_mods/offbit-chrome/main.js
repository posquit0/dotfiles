import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

// Keep gesture state in the footer, shared by every sidebar section.
function scrollMachineScope(event, cx) {
  const delta = event.delta_lines ?? event.delta;
  run(`offbit-machine-scope.scroll-${JSON.stringify({ delta: event.delta, delta_lines: event.delta_lines, touch_phase: event.touch_phase, at: Date.now() })}`);
  if (Math.abs(delta.x) > Math.abs(delta.y) * 1.25) cx.stop_propagation();
}

// Native text frames move the palette right once every five seconds.
const brandColors = ["#c4b5fd", "#ccb3f7", "#d3b1f1", "#dbafeb", "#e2aee6", "#eaace0", "#f1aada", "#f9a8d4", "#eaacda", "#dcb0e0", "#cdb4e6", "#bfb9eb", "#b0bdf1", "#a2c1f7", "#93c5fd", "#9ac3fd", "#a1c0fd", "#a8befd", "#afbcfd", "#b6bafd", "#bdb7fd"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/offbit-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .on_scroll_wheel(scrollMachineScope)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).items_center().overflow_hidden()
        .child(h_flex().flex_none().font_family("Ubuntu").text_size(14).font_bold().accessibility_label("offbit terminal")
          .children(Array.from("offbit\u00a0terminal").map((letter, i) => div().relative().flex_none()
            .child(div().opacity(0).child(letter))
            .children(brandColors.map((color, phase) => div().id(`brand-${i}-${phase}`).absolute().left(0).top(0)
              .text_color(color).frames(brandColors.map((_, frame) =>
                (i - frame + brandColors.length) % brandColors.length === phase ? letter : ""), 5000 / brandColors.length))))))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/offbit-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/offbit-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
