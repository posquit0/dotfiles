import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, machines, shared, setShared, theme, settings } from "herdr";
import { SCOPE_KEY, machineNames, selectedMachine, cycleScope, machineLabel, swipeDirection } from "./scope.js";

export default class MachineScope extends View {
  init() {
    this.width = 268;
    this.swipe = { acc: 0, at: 0, direction: 0, switched: false };
  }

  cycle(direction) {
    setShared(SCOPE_KEY, cycleScope(shared(SCOPE_KEY), machineNames(spaces(), machines()), direction));
  }

  render() {
    const t = theme();
    const names = machineNames(spaces(), machines());
    const scope = shared(SCOPE_KEY);
    const machine = selectedMachine(scope, names);
    if (scope && machine === undefined) setShared(SCOPE_KEY, null);
    const label = machineLabel(machine);
    const compact = this.width < 160;
    const arrow = (direction, icon) => div().id(`machine-scope-${direction < 0 ? "prev" : "next"}`)
      .size(compact ? 16 : 24).flex_none().flex().items_center().justify_center().rounded(5)
      .text_color(t.muted).cursor_pointer().hover(style => style.bg(t.hover).text_color(t.foreground))
      .tooltip(direction < 0 ? "Previous machine scope" : "Next machine scope")
      .on_click(() => this.cycle(direction))
      .child(svg(`mods/workspace-chrome/chevron-${icon}.svg`).size(12));
    return h_flex().id("machine-scope").size_full().px(compact ? 2 : 10).gap(compact ? 0 : 6)
      .items_center().bg(t.chrome).border_t(2).border_color(t.input)
      .tooltip(`Machine scope: ${label} · Swipe left/right · All → Local${names.slice(1).map(name => ` → ${name}`).join("")} → All`)
      .on_size_change((size, cx) => {
        const width = size.width / (Number(settings().zoom) || 1);
        if (Math.abs(this.width - width) >= 1) { this.width = width; cx.notify(); }
      })
      .on_scroll_wheel((event, cx) => {
        const direction = swipeDirection(this.swipe, event, Date.now());
        if (direction) this.cycle(direction);
        if (Math.abs((event.delta_lines ?? event.delta).x) > Math.abs((event.delta_lines ?? event.delta).y) * 1.25) cx.stop_propagation();
      })
      .child(arrow(-1, "left"))
      .child(h_flex().flex_1().min_w(0).gap(7).items_center().justify_center().text_color(t.foreground)
        .child(svg(`mods/workspace-chrome/${machine === undefined ? "layers" : machine === null ? "monitor" : "server"}.svg`).size(14).flex_none())
        .when(!compact, el => el.child(div().min_w(0).truncate().text_size(12).font_semibold().child(label))))
      .child(arrow(1, "right"));
  }
}
