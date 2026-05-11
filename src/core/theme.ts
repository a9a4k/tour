/**
 * Single source of truth for the GitHub Dark Default palette used by the
 * TUI and the web SPA. Both surfaces read tokens from this module instead
 * of inlining hex literals.
 *
 * Tier 1 tokens are direct Primer scale steps (solid hex on both surfaces).
 * Tier 2 tokens are alpha-on-canvas pairs: the web emits the alpha form
 * (`token.web`), the TUI emits the pre-resolved solid (`token.tui`) so the
 * two render visually identical when applied over `canvas.default`.
 *
 * `fg.accent` is pinned to `#58a6ff` (Primer `blue.3`) per ADR 0008 even
 * though current github.com uses `#4493F8` — the older step has higher
 * contrast (AAA, 7.4:1 on canvas.default vs AA, 6.0:1).
 *
 * Keys are camelCase (e.g. `accentEmphasis`); the corresponding CSS custom
 * property is dash-cased and prefixed by group (e.g. `--bg-accent-emphasis`).
 */
export interface AlphaPair {
  /** Web form: alpha rgba string applied directly. */
  web: string;
  /** TUI form: solid hex pre-resolved over `canvas.default`. */
  tui: string;
}

export const theme = {
  canvas: {
    default: "#0d1117",
    subtle: "#151b23",
    inset: "#010409",
    emphasis: "#3d444d",
  },
  fg: {
    default: "#f0f6fc",
    muted: "#9198a1",
    subtle: "#656c76",
    onEmphasis: "#ffffff",
    accent: "#58a6ff",
    cursor: "#58a6ff",
    success: "#3fb950",
    attention: "#d29922",
    severe: "#db6d28",
    danger: "#f85149",
    done: "#ab7df8",
  },
  border: {
    default: "#3d444d",
    muted: "#2f3742",
    accent: "#58a6ff",
  },
  bg: {
    accentEmphasis: "#1f6feb",
    successEmphasis: "#238636",
    dangerEmphasis: "#da3633",
    accentCursor: {
      web: "rgba(31, 111, 235, 0.20)",
      tui: "#112441",
    } satisfies AlphaPair,
    accentCurrent: {
      web: "rgba(31, 111, 235, 0.13)",
      tui: "#0f1e33",
    } satisfies AlphaPair,
    accentSubtle: {
      web: "rgba(31, 111, 235, 0.10)",
      tui: "#0f1b2d",
    } satisfies AlphaPair,
    accentRange: {
      web: "rgba(56, 139, 253, 0.15)",
      tui: "#132339",
    } satisfies AlphaPair,
    cursorRow: {
      web: "rgba(31, 111, 235, 0.30)",
      tui: "#1a3566",
    } satisfies AlphaPair,
    successRange: {
      web: "rgba(63, 185, 80, 0.15)",
      tui: "#142a20",
    } satisfies AlphaPair,
    dangerRange: {
      web: "rgba(248, 81, 73, 0.15)",
      tui: "#301b1e",
    } satisfies AlphaPair,
    attentionSubtle: {
      web: "rgba(210, 153, 34, 0.10)",
      tui: "#1c1a12",
    } satisfies AlphaPair,
    neutralSubtle: {
      web: "rgba(110, 118, 129, 0.20)",
      tui: "#22262d",
    } satisfies AlphaPair,
  },
  /**
   * Web-only translucent overlays. Not in the Primer-aligned token list
   * but needed by the SPA for picker scrim and elevation shadows. The TUI
   * has no equivalent (no z-stacked overlays beyond solid backgrounds).
   */
  shadow: {
    scrim: "rgba(1, 4, 9, 0.7)",
    medium: "rgba(0, 0, 0, 0.4)",
    large: "rgba(0, 0, 0, 0.5)",
  },
} as const;

/**
 * Emit `:root { --token: value; ... }` for the SPA stylesheet to consume.
 * Tier 2 tokens are emitted as the web alpha form; the TUI reads `theme.bg.*.tui`
 * directly without going through CSS variables.
 */
export function themeCSSVars(): string {
  const lines: string[] = [
    `--canvas-default: ${theme.canvas.default};`,
    `--canvas-subtle: ${theme.canvas.subtle};`,
    `--canvas-inset: ${theme.canvas.inset};`,
    `--canvas-emphasis: ${theme.canvas.emphasis};`,
    `--fg-default: ${theme.fg.default};`,
    `--fg-muted: ${theme.fg.muted};`,
    `--fg-subtle: ${theme.fg.subtle};`,
    `--fg-on-emphasis: ${theme.fg.onEmphasis};`,
    `--fg-accent: ${theme.fg.accent};`,
    `--fg-success: ${theme.fg.success};`,
    `--fg-attention: ${theme.fg.attention};`,
    `--fg-severe: ${theme.fg.severe};`,
    `--fg-danger: ${theme.fg.danger};`,
    `--fg-done: ${theme.fg.done};`,
    `--border-default: ${theme.border.default};`,
    `--border-muted: ${theme.border.muted};`,
    `--border-accent: ${theme.border.accent};`,
    `--bg-accent-emphasis: ${theme.bg.accentEmphasis};`,
    `--bg-success-emphasis: ${theme.bg.successEmphasis};`,
    `--bg-danger-emphasis: ${theme.bg.dangerEmphasis};`,
    `--bg-accent-cursor: ${theme.bg.accentCursor.web};`,
    `--bg-accent-current: ${theme.bg.accentCurrent.web};`,
    `--bg-accent-subtle: ${theme.bg.accentSubtle.web};`,
    `--bg-accent-range: ${theme.bg.accentRange.web};`,
    `--bg-cursor-row: ${theme.bg.cursorRow.web};`,
    `--bg-success-range: ${theme.bg.successRange.web};`,
    `--bg-danger-range: ${theme.bg.dangerRange.web};`,
    `--bg-attention-subtle: ${theme.bg.attentionSubtle.web};`,
    `--bg-neutral-subtle: ${theme.bg.neutralSubtle.web};`,
    `--shadow-scrim: ${theme.shadow.scrim};`,
    `--shadow-medium: ${theme.shadow.medium};`,
    `--shadow-large: ${theme.shadow.large};`,
  ];
  return `:root {\n  ${lines.join("\n  ")}\n}`;
}
