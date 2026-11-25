// Native visual system for Analytics.
//
// The conventions are shadcn-inspired: one restrained neutral surface, 1px
// borders, a small radius scale, a clear type hierarchy, and one primary action.
// The implementation is gpui only, and every color comes from the operator's
// Herdr theme through the semantic mapping below. There is no DOM, CSS or web
// component layer, and no dependency beyond the host's gpui modules.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Toggle } from "gpui-base";

/** Radii: controls stay tighter than cards, as in shadcn's default scale. */
export const R = { control: 6, card: 8 };
/** Control heights keep toolbars, inputs and buttons on one line. */
export const H = { control: 30, compact: 24 };
/** The spacing rhythm: 4 / 8 / 12 / 16 / 24. */
export const G = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
/** Type steps: page, card, metric, body, small and uppercase labels. */
export const T = { page: 20, card: 13.5, metric: 22, value: 12.5, body: 11.5, small: 10.5, label: 9.5 };

// Reuse Herdr's agent icons so Analytics matches terminal headers and the sidebar.
const AGENT_ICONS = {
  codex: { name: "Codex", key: "codex" },
  claude: { name: "Claude Code", key: "claude" },
  claudecode: { name: "Claude Code", key: "claude" },
  kiro: { name: "Kiro", key: "kiro" },
  kirocli: { name: "Kiro", key: "kiro" },
  pi: { name: "Pi", key: "pi", tint: true },
  opencode: { name: "OpenCode", key: "opencode", tint: true },
  antigravity: { name: "Antigravity", key: "antigravity" },
};

export function agentIcon(id, value, c, { program, label, size = 18 } = {}) {
  const known = AGENT_ICONS[String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")];
  const name = label || program?.name || known?.name || String(value || "Unknown agent");
  const path = program?.icon || (known ? `icons/${known.key}.svg` : null);
  const tint = program?.icon ? program.tint : known?.tint;
  return h_flex().id(id).size(size + 8).flex_none().items_center().justify_center()
    .rounded(R.control).tooltip(name).accessibility_label(name)
    .child(path
      ? (tint ? svg(path).text_color(c.mutedForeground) : image(path)).size(size).flex_none()
      : div().text_size(T.small).font_medium().text_color(c.mutedForeground).child(name.slice(0, 2).toUpperCase()));
}

/**
 * shadcn's paired semantic tokens, mapped onto Herdr's theme names.
 * `primary` is the monochrome high-emphasis action color (`solid`), not the
 * operator accent or the configured heatmap palette. `ring` is the single
 * accent used for focus. Light and dark themes map identically.
 */
export function tokens(t = {}) {
  const background = t.background;
  const canvas = t.canvas ?? background;
  const card = t.surface ?? canvas;
  const secondary = t.raised ?? card;
  return {
    background,
    canvas,
    card,
    popover: t.popover ?? card,
    primary: t.solid ?? t.foreground,
    primaryForeground: t.solid_foreground ?? background,
    secondary,
    secondaryForeground: t.foreground,
    muted: secondary,
    mutedForeground: t.muted ?? t.dim,
    subtle: t.hover ?? secondary,
    selected: t.selected ?? t.hover ?? secondary,
    accent: t.accent,
    accentForeground: t.accent_foreground ?? background,
    destructive: t.blocked ?? t.ansi1,
    border: t.border ?? t.input,
    input: t.input ?? t.border,
    ring: t.accent,
    text: t.foreground,
    dim: t.dim,
    done: t.done ?? t.ansi2,
    selection: t.selection,
  };
}

export function pageTitle(text, c) {
  return div().text_size(T.page).font_semibold().text_color(c.text).child(text);
}

export function cardTitle(text, c) {
  return div().text_size(T.card).font_semibold().text_color(c.text).child(text);
}

export function cardHeader(title, subtitle, c) {
  return v_flex().gap(2)
    .child(cardTitle(title, c))
    .when(Boolean(subtitle), (el) => el.child(div().text_size(T.small).text_color(c.dim).child(subtitle)));
}

export function fieldLabel(text, c) {
  return div().text_size(T.body).font_medium().text_color(c.text).child(text);
}

export function metaLabel(text, c) {
  return div().text_size(T.label).font_medium().text_color(c.dim).child(String(text).toUpperCase());
}

export function bodyText(text, c, size = T.body) {
  return div().text_size(size).text_color(c.mutedForeground).child(text);
}

export function mutedText(text, c, size = T.small) {
  return div().text_size(size).text_color(c.dim).child(text);
}

export function card(c, padding = G.lg, gap = G.md) {
  return v_flex().w_full().min_w(0).p(padding).gap(gap).rounded(R.card).bg(c.card)
    .border_1().border_color(c.border);
}

export function inset(c, padding = G.md, gap = G.sm) {
  return v_flex().w_full().min_w(0).p(padding).gap(gap).rounded(R.control).bg(c.muted)
    .border_1().border_color(c.border);
}

/**
 * A labelled value in a card or data grid. Values truncate with the exact value
 * kept in the tooltip, so compact dashboard numbers never lose their source.
 */
export function statCell(label, display, c, options = {}) {
  return v_flex().flex_1().min_w(76).gap(G.xs)
    .when(options.align === "end", (el) => el.items_end())
    .child(metaLabel(label, c))
    .child(div().text_size(T.value).font_medium().text_color(options.color ?? c.text).truncate()
      .tooltip(options.tooltip ?? String(display)).child(display))
    .when(Boolean(options.note), (el) => el.child(div().text_size(T.label).text_color(c.dim).truncate().child(options.note)));
}

/**
 * One button family: primary (filled solid), secondary (raised), outline
 * (card with border) and ghost (no fill). Buttons are native gpui-base
 * Buttons, so keyboard activation and a visible focus treatment come for free.
 */
export function button(id, label, onClick, c, options = {}) {
  const variant = options.variant ?? "secondary";
  const disabled = Boolean(options.disabled);
  const primary = variant === "primary";
  const ghost = variant === "ghost";
  const foreground = primary ? c.primaryForeground : ghost ? c.mutedForeground : c.text;

  let el = Button.new(id).h(H.control).items_center().justify_center().rounded(R.control)
    .cursor_pointer()
    .on_click((event, cx) => { if (!disabled) onClick(event, cx); })
    .disabled(disabled)
    .accessibility_label(options.accessibilityLabel ?? options.tooltip ?? (typeof label === "string" ? label : "Button"))
    .when(Boolean(options.tooltip), (root) => root.tooltip(options.tooltip))
    .when(options.square === true, (root) => root.w(H.control))
    .when(options.square !== true, (root) => root.px(options.padding ?? 10));

  if (primary) el = el.bg(c.primary).border_1().border_color(c.primary);
  else if (variant === "outline") el = el.bg(c.card).border_1().border_color(c.border);
  else if (ghost) el = el.border_0();
  else el = el.bg(c.secondary).border_1().border_color(c.border);

  el = el.opacity(disabled ? 0.5 : 1)
    .when(!disabled, (root) => root.hover((style) => {
      if (primary) style.opacity(0.92);
      else style.bg(c.subtle);
    }))
    .when(!disabled, (root) => root.active((style) => style.opacity(0.86)))
    .focus((style) => {
      if (ghost) style.bg(c.selected);
      else style.border_color(c.ring);
    });

  const content = typeof label === "string"
    ? div().text_size(options.textSize ?? T.body).font_medium().text_color(foreground).child(label)
    : label;
  return el.child(content);
}

export function iconButton(id, glyph, label, onClick, c, options = {}) {
  return button(id, div().text_size(14).text_color(options.color ?? c.mutedForeground).child(glyph), onClick, c, {
    accessibilityLabel: label,
    disabled: options.disabled,
    square: true,
    tooltip: label,
    variant: options.variant ?? "ghost",
  });
}

/** Segmented tabs: selected state is surface + border, hover is neutral. */
export function segmented(id, items, value, onChange, c) {
  return h_flex().id(id).min_h(H.control).flex_wrap().items_center().gap(2).p(2).rounded(R.card)
    .bg(c.secondary).border_1().border_color(c.border)
    .children(items.map((item, index) => {
      const selected = value === item.key;
      return Button.new(`${id}-${item.key}`).h(H.compact).px(8).items_center().justify_center().rounded(R.control)
        .border_1().border_color(selected ? c.border : c.secondary)
        .bg(selected ? c.card : c.secondary)
        .selected(selected)
        .set_position(index + 1, items.length)
        .cursor_pointer()
        .accessibility_label(item.label)
        .when(!selected, (el) => el.hover((style) => style.bg(c.subtle)))
        .focus((style) => style.border_color(c.ring))
        .on_click((_event, cx) => {
          if (selected) return;
          onChange(item.key, cx);
          cx.notify();
        })
        .child(div().text_size(T.small).font_medium().text_color(selected ? c.text : c.mutedForeground).child(item.label));
    }));
}

/** A controlled native toggle, drawn in the same neutral language as the rest. */
export function toggleSwitch(id, checked, onChange, c, options = {}) {
  return Toggle.new(id).w(36).h(20).p(2).items_center().rounded_full()
    .bg(checked ? c.primary : c.secondary).border_1().border_color(checked ? c.primary : c.input)
    .cursor_pointer().pressed(checked)
    .accessibility_label(options.label ?? "Toggle")
    .on_change((next, cx) => {
      onChange(next, cx);
      cx.notify();
    })
    .hover((style) => style.border_color(checked ? c.primary : c.input))
    .focus((style) => style.border_color(c.ring))
    .child(div().size(14).flex_none().rounded_full()
      .bg(checked ? c.primaryForeground : c.mutedForeground)
      .when(checked, (el) => el.ml(16)));
}

export function controlInput(el, c) {
  return el.h(H.control).px(8).rounded(R.control).border_1().border_color(c.input).bg(c.canvas)
    .text_size(T.body).text_color(c.text).focus((style) => style.border_color(c.ring));
}

/** A finite empty / loading / error surface with one optional action. */
export function stateCard(c, options = {}) {
  const tone = options.tone ?? c.accent;
  return v_flex().w_full().p(G.xl).gap(G.sm).rounded(R.card).bg(c.card)
    .border_1().border_color(tone === c.destructive ? c.destructive : c.border)
    .child(h_flex().items_center().gap(G.sm)
      .child(div().size(8).flex_none().rounded_full().bg(tone))
      .child(div().text_size(T.card).font_semibold().text_color(c.text).child(options.title)))
    .when(Boolean(options.body), (el) => el.child(div().text_size(T.body).text_color(c.mutedForeground).child(options.body)))
    .when(Boolean(options.detail), (el) => el.child(div().text_size(T.label).text_color(c.dim).child(options.detail)))
    .when(Boolean(options.action), (el) => el.child(h_flex().pt(G.xs).child(options.action)));
}

/** A banner inside the dashboard; errors are the only routine use of the red tone. */
export function notice(c, options = {}) {
  const tone = options.tone ?? c.destructive;
  return h_flex().w_full().gap(G.md).items_start().p(G.md).rounded(R.control).bg(c.card)
    .border_1().border_color(tone)
    .child(div().mt(1).size(7).flex_none().rounded_full().bg(tone))
    .child(v_flex().flex_1().min_w(0).gap(G.xs)
      .child(div().text_size(12).font_semibold().text_color(c.text).child(options.title))
      .child(div().text_size(T.small).text_color(c.mutedForeground).child(options.body)))
    .when(Boolean(options.action), (el) => el.child(options.action));
}
