import { themeCSSVars } from "../core/theme.js";

export function html(initialTourId?: string, replyAgent?: string): string {
  const initialId = initialTourId ? JSON.stringify(initialTourId) : "null";
  const initialReplyAgent = replyAgent ? JSON.stringify(replyAgent) : "null";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tour</title>
<style>
  ${themeCSSVars()}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { color-scheme: dark; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--canvas-default);
    color: var(--fg-default);
    height: 100vh;
    overflow: hidden;
  }
  #root { display: flex; flex-direction: column; height: 100%; }
  .app-body { display: flex; flex: 1; min-height: 0; }
  /* Issue #323: sidebar width is now React state (default 280px before
     auto-fit lands), so the inline style wins at runtime. The 280px
     rule below is kept as a fallback for any pre-mount paint.
     position: relative anchors the absolute drag handle.
     Scroll lives on the inner .sidebar-scroll, not on the aside.
     When the aside scrolls itself, its vertical scrollbar (~16 px on
     macOS Chromium) shifts the absolute drag handle inward by the
     same amount, hiding the handle behind the scrollbar and leaving
     a dead zone between the handle and the visible right edge. */
  .app-sidebar {
    width: 280px;
    border-right: 1px solid var(--border-default);
    flex-shrink: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  /* PRD #343 / ADR 0031 / issue #346: 2px accent left-border when
     paneFocus = sidebar. Mirrors the TUI's border-color flip — a
     glanceable pane-level cue that complements the per-row
     :focus-visible outline below. */
  .app-sidebar[data-pane-focus="sidebar"] {
    box-shadow: inset 2px 0 0 0 var(--border-accent);
  }
  /* Roving-tabindex focus outline. The browser's native focus ring
     would also fire here but is suppressed on mouse via :focus-visible
     so only keyboard-driven focus shows the outline. */
  .sidebar-scroll [role="treeitem"]:focus-visible {
    outline: 2px solid var(--border-accent);
    outline-offset: -2px;
  }
  .sidebar-scroll {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .sidebar-resize-handle {
    position: absolute;
    top: 0;
    right: -2px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    user-select: none;
    z-index: 5;
    /* Transparent grab zone; reveal a 2px accent line on hover so the
       affordance is discoverable without visual chrome at rest. */
    background: transparent;
  }
  .sidebar-resize-handle:hover,
  .sidebar-resize-handle:active {
    background:
      linear-gradient(
        to right,
        transparent 0,
        transparent 3px,
        var(--border-accent) 3px,
        var(--border-accent) 5px,
        transparent 5px,
        transparent 8px
      );
  }
  /* Suppress text selection across the document during an in-flight
     drag (mouse moves over the diff body shouldn't paint a selection
     under the cursor). The class is toggled on the aside by the
     drag handlers. */
  .app-sidebar.is-resizing {
    cursor: col-resize;
  }
  .app-sidebar.is-resizing,
  .app-sidebar.is-resizing * {
    user-select: none;
  }
  .file-entry {
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: transparent;
    color: inherit;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }
  .file-entry:hover { background: var(--canvas-subtle); }
  .file-entry.selected { background: var(--bg-accent-cursor); border-left: 2px solid var(--border-accent); }
  .folder-entry {
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    color: var(--fg-default);
    width: 100%;
    text-align: left;
    font-family: inherit;
  }
  .folder-entry:hover { background: var(--canvas-subtle); }
  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-muted);
  }
  .tree-icon { width: 16px; height: 16px; flex-shrink: 0; color: var(--fg-muted); }
  .status-icon { width: 16px; height: 16px; flex-shrink: 0; color: currentColor; }
  .status-icon.added { color: #3fb950; }
  .status-icon.modified { color: #d29922; }
  .status-icon.deleted { color: #f85149; }
  .status-icon.renamed { color: #a371f7; }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reason-tag { color: var(--fg-muted); font-size: 11px; font-style: italic; }
  .rename-path {
    color: var(--fg-muted);
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .rename-placeholder {
    color: var(--fg-muted);
    font-size: 12px;
    font-style: italic;
    padding: 12px 16px;
    border-top: 1px solid var(--border-default);
  }
  .badge {
    background: var(--canvas-emphasis);
    color: var(--fg-muted);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 11px;
    margin-left: auto;
  }
  .app-main { flex: 1; overflow-y: auto; padding: 0 16px 16px; }
  .banner {
    background: var(--bg-attention-subtle);
    border: 1px solid var(--fg-attention);
    color: var(--fg-attention);
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 16px;
  }
  .tour-header {
    padding-top: 16px;
    padding-bottom: 12px;
    padding-left: 16px;
    padding-right: 16px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .tour-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .tour-header h1 {
    font-size: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 0 1 auto;
  }
  .tour-header h1.untitled { color: var(--fg-muted); font-weight: 400; }
  .tour-refs {
    color: var(--fg-muted);
    font-size: 13px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
  }
  .tour-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
  }
  /* Issue #390 / ADR 0021 addendum: header chip naming the configured
     reply-agent and flagging it as a separate session. Render only when
     --reply-agent is set; muted treatment so it sits alongside the
     stats / sequence-pill cluster without stealing attention. */
  .reply-agent-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--fg-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border-muted, rgba(127, 127, 127, 0.3));
    border-radius: 999px;
    padding: 2px 10px;
    white-space: nowrap;
  }
  .reply-agent-chip strong {
    color: var(--fg-default);
    font-weight: 600;
  }
  /* Issue #390 / ADR 0021 addendum: byline marker on agent-authored
     Replies (which are by construction reply-agent products — see
     src/core/reply-runner.ts's createReply call). Muted treatment
     mirrors the chip so the role indicator is legible without
     competing with the author name. */
  .reply-agent-byline {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .tour-stats {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .tour-stats-count.added { color: var(--fg-success); }
  .tour-stats-count.deleted { color: var(--fg-danger); }
  .picker-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    min-height: 32px;
    align-self: center;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-default);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    font-family: inherit;
    flex-shrink: 0;
  }
  .picker-button:hover { background: var(--canvas-subtle); }
  .picker-button:focus-visible {
    outline: 1px solid var(--border-accent);
    outline-offset: 2px;
  }
  .layout-toggle {
    display: inline-flex;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .layout-toggle-btn {
    background: transparent;
    border: none;
    color: var(--fg-default);
    font-family: inherit;
    font-size: 12px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .layout-toggle-btn:hover { background: var(--canvas-subtle); }
  .layout-toggle-btn.active {
    background: var(--bg-accent-emphasis);
    color: var(--fg-on-emphasis);
  }
  .layout-toggle-btn + .layout-toggle-btn { border-left: 1px solid var(--border-default); }
  /* Issue #331: webapp footer hint strip — bottom sibling of #root's
     column-flex, never position: fixed (no padding-bottom hack on the
     scroll container). 1px hairline border-top, page canvas background,
     muted foreground, wraps to a second line below ~1100px viewport so
     the legend never clips. */
  .app-footer {
    flex-shrink: 0;
    padding: 6px 16px;
    border-top: 1px solid var(--border-muted);
    background: var(--canvas-default);
    color: var(--fg-muted);
    font-size: 12px;
    line-height: 1.4;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 8px;
  }
  .app-footer-status,
  .app-footer-legend {
    overflow-wrap: anywhere;
  }
  .file-block {
    margin-bottom: 24px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    scroll-margin-top: 16px;
    position: relative;
  }
  .copy-path {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--fg-muted);
    font-size: 14px;
    line-height: 1;
    padding: 0;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .copy-path:hover { color: var(--fg-default); }
  .copy-path:focus-visible { outline: 1px solid var(--border-accent); outline-offset: 2px; border-radius: 2px; }
  .comment-block {
    border: 1px solid var(--border-default);
    border-left: 3px solid var(--border-accent);
    background: var(--canvas-subtle);
    margin: 4px 16px 4px 0;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    min-width: 0;
    max-width: 100%;
  }
  .comment-block.current {
    border-color: var(--border-accent);
    box-shadow: 0 2px 8px var(--shadow-medium);
  }
  .comment-block .selection-marker { color: var(--fg-accent); font-weight: 700; }
  .comment-block .nav-index { color: var(--fg-muted); font-weight: 600; }
  .comment-block .ann-header {
    color: var(--fg-accent);
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  /* Issue 383 / ADR 0035: annotation filename location-stamp link.
     Renders as an inline button — strip the button chrome so the text
     stays in-flow with the rest of the header, then re-add a hover
     underline + pointer cursor. No link-blue: the affordance reads as
     a subtle location reference, matching Sentry / devtools / Sourcegraph. */
  .comment-block .ann-filename-link {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .comment-block .ann-filename-link:hover {
    text-decoration: underline;
  }
  .comment-block .ann-filename-link:focus-visible {
    outline: 1px solid var(--border-accent);
    outline-offset: 1px;
    border-radius: 2px;
  }
  .comment-block .author-kind {
    text-transform: lowercase;
    font-weight: 700;
  }
  .comment-block .author-kind.agent { color: var(--fg-muted); }
  .comment-block .author-kind.human { color: var(--fg-accent); }
  .comment-block .ann-replies {
    margin-top: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border-muted);
  }
  .comment-block .ann-reply { margin-top: 8px; }
  .comment-block .ann-reply:first-child { margin-top: 0; }
  /* Issue #408 / ADR 0037 — within-Card active-node cue. The Card chrome
     (.comment-block.current) signals "cursor is somewhere in this Thread";
     .active-node narrows to the specific node (parent header or one reply).
     Mirrors the TUI's bullet glyph + reply background tint. The left-accent
     stroke + subtle tint reads as a distinct emphasis level from the Card
     chrome so a user can tell at a glance both which Thread is current AND
     which node within it the cursor sits on. */
  .comment-block .ann-header.active-node {
    border-left: 2px solid var(--border-accent);
    background: var(--bg-accent-current);
    margin-left: -8px;
    padding-left: 6px;
    border-radius: 2px;
  }
  .comment-block .ann-reply.active-node {
    border-left: 2px solid var(--border-accent);
    background: var(--bg-accent-current);
    margin-left: -8px;
    padding-left: 6px;
    border-radius: 2px;
  }
  .comment-block .ann-actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .comment-block .reply-button {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
  }
  .comment-block .reply-button:hover {
    background: var(--canvas-subtle);
    color: var(--fg-default);
  }
  .comment-block .send-to-agent-button {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
  }
  .comment-block .send-to-agent-button:not(:disabled):hover {
    background: var(--canvas-subtle);
    color: var(--fg-default);
  }
  .comment-block.current .send-to-agent-button:not(:disabled) {
    color: var(--fg-accent);
    border-color: var(--border-accent);
  }
  .comment-block .send-to-agent-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .comment-block .ann-reply-composer {
    margin-top: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border-muted);
  }
  /* Issue #389 / ADR 0036 (Slice E): trash icon on every comment card.
     Hover-revealed on the parent header and on each inline Reply; the
     focus-visible outline keeps the affordance reachable via keyboard
     tab from any caret position inside the card. */
  .comment-block .ann-header {
    position: relative;
  }
  .comment-block .ann-trash-button,
  .comment-block .ann-reply .ann-trash-button {
    background: transparent;
    border: none;
    padding: 0 4px;
    margin-left: 6px;
    color: var(--fg-muted);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    opacity: 0;
    transition: opacity 80ms ease-in;
    vertical-align: middle;
  }
  .comment-block:hover .ann-trash-button,
  .comment-block .ann-reply:hover .ann-trash-button,
  .comment-block .ann-trash-button:focus-visible {
    opacity: 1;
  }
  .comment-block .ann-trash-button:hover {
    color: var(--fg-danger);
  }
  .comment-block .ann-trash-button:focus-visible {
    outline: 1px solid var(--border-accent);
    outline-offset: 1px;
    border-radius: 2px;
  }
  /* Issue #389: [deleted] stub rendering for parents whose body is
     gone but whose surviving replies still appear underneath. The card
     keeps its anchor + chrome but the body slot is replaced by a muted
     italic placeholder; the trash icon is suppressed on stubs (nothing
     to delete a second time). */
  .comment-block.deleted-stub .ann-body {
    color: var(--fg-muted);
    font-style: italic;
  }
  .comment-block.deleted-stub .ann-trash-button,
  .comment-block .ann-reply.deleted-stub .ann-trash-button {
    display: none;
  }
  /* PRD #397 / ADR 0038: per-Thread collapse. The header chevron is the
     mouse-driven counterpart of Shift+C; the one-liner Card shape
     trims the body + replies down to a single row so a reviewer can
     skim past Threads they've already absorbed. */
  .comment-block .ann-collapse-chevron {
    background: transparent;
    border: none;
    padding: 0 4px;
    margin-right: 4px;
    color: var(--fg-muted);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    vertical-align: middle;
  }
  .comment-block .ann-collapse-chevron:hover {
    color: var(--fg-default);
  }
  .comment-block .ann-collapse-chevron:focus-visible {
    outline: 1px solid var(--border-accent);
    outline-offset: 1px;
    border-radius: 2px;
  }
  .comment-block.collapsed .ann-header-collapsed {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0;
  }
  .comment-block.collapsed .ann-collapsed-preview {
    color: var(--fg-muted);
  }
  .comment-block.collapsed .ann-collapsed-reply-count {
    color: var(--fg-muted);
  }
  /* Issue #389: delete-confirm modal — mirrors the picker-card chrome
     so the two modals read as one family. */
  .delete-modal-scrim {
    position: fixed;
    inset: 0;
    background: var(--shadow-scrim);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 40;
  }
  .delete-modal-card {
    width: min(480px, 90vw);
    background: var(--canvas-subtle);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--shadow-large);
    padding: 16px 20px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .delete-modal-card:focus { outline: none; }
  .delete-modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-default);
    margin: 0;
  }
  .delete-modal-preview {
    border: 1px solid var(--border-muted);
    border-radius: 4px;
    padding: 8px 10px;
    background: var(--canvas-default);
  }
  .delete-modal-preview-header {
    color: var(--fg-accent);
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .delete-modal-preview-header .author-kind {
    text-transform: lowercase;
    font-weight: 700;
  }
  .delete-modal-preview-header .author-kind.agent { color: var(--fg-muted); }
  .delete-modal-preview-header .author-kind.human { color: var(--fg-accent); }
  .delete-modal-preview-header .delete-modal-location {
    color: var(--fg-default);
    font-weight: 500;
  }
  .delete-modal-preview-header .delete-modal-age {
    color: var(--fg-muted);
    font-weight: 400;
  }
  .delete-modal-preview-body {
    color: var(--fg-default);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    max-height: 12em;
    overflow-y: auto;
  }
  .delete-modal-cascade {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .delete-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .delete-modal-cancel,
  .delete-modal-confirm {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-default);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    padding: 4px 14px;
  }
  .delete-modal-cancel:hover { background: var(--canvas-subtle); }
  .delete-modal-confirm {
    background: var(--fg-danger);
    color: var(--fg-on-emphasis);
    border-color: transparent;
  }
  .delete-modal-confirm:hover { filter: brightness(1.1); }
  .delete-modal-confirm:focus-visible,
  .delete-modal-cancel:focus-visible {
    outline: 2px solid var(--border-accent);
    outline-offset: 1px;
  }
  .composer {
    margin: 4px 16px 4px 0;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 8px 12px;
    background: var(--canvas-subtle);
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .composer-textarea {
    width: 100%;
    min-height: 64px;
    background: var(--canvas-default);
    color: var(--fg-default);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    resize: vertical;
    box-sizing: border-box;
  }
  .composer-textarea:focus {
    outline: 1px solid var(--border-accent);
    outline-offset: 0;
  }
  .composer-error {
    margin-top: 6px;
    color: var(--fg-danger);
    font-size: 12px;
  }
  .composer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 8px;
  }
  .composer-cancel,
  .composer-submit {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-default);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
  }
  .composer-cancel:hover { background: var(--canvas-subtle); }
  .composer-submit {
    background: var(--bg-accent-emphasis);
    color: var(--fg-on-emphasis);
    border-color: transparent;
  }
  .composer-submit:disabled {
    background: var(--canvas-subtle);
    color: var(--fg-muted);
    cursor: default;
  }
  .reply-pill {
    margin-top: 10px;
    padding: 6px 10px;
    background: var(--canvas-subtle);
    border: 1px solid var(--border-muted);
    border-radius: 4px;
    color: var(--fg-muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .reply-pill.stale {
    border-color: var(--fg-attention);
    color: var(--fg-attention);
    flex-wrap: wrap;
  }
  .reply-pill .reply-pill-icon { font-size: 14px; }
  .comment-block .ann-body { color: var(--fg-default); overflow-wrap: anywhere; white-space: normal; }
  .comment-block .ann-body > * { margin: 0 0 8px; }
  .comment-block .ann-body > *:last-child { margin-bottom: 0; }
  .comment-block .ann-body h1,
  .comment-block .ann-body h2,
  .comment-block .ann-body h3,
  .comment-block .ann-body h4,
  .comment-block .ann-body h5,
  .comment-block .ann-body h6 {
    font-weight: 600;
    line-height: 1.25;
    margin: 12px 0 6px;
    color: var(--fg-default);
  }
  .comment-block .ann-body h1 { font-size: 1.4em; }
  .comment-block .ann-body h2 { font-size: 1.25em; }
  .comment-block .ann-body h3 { font-size: 1.1em; }
  .comment-block .ann-body h4,
  .comment-block .ann-body h5,
  .comment-block .ann-body h6 { font-size: 1em; }
  .comment-block .ann-body p { line-height: 1.5; }
  .comment-block .ann-body ul,
  .comment-block .ann-body ol { padding-left: 24px; line-height: 1.5; }
  .comment-block .ann-body li { margin: 2px 0; }
  .comment-block .ann-body li input[type="checkbox"] {
    margin-right: 6px;
    vertical-align: middle;
  }
  .comment-block .ann-body blockquote {
    border-left: 3px solid var(--border-muted);
    padding: 0 12px;
    color: var(--fg-muted);
    margin: 8px 0;
  }
  .comment-block .ann-body a { color: var(--fg-accent); text-decoration: none; }
  .comment-block .ann-body a:hover { text-decoration: underline; }
  .comment-block .ann-body code {
    background: var(--bg-neutral-subtle);
    border-radius: 3px;
    padding: 0.15em 0.35em;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9em;
  }
  .comment-block .ann-body pre {
    background: var(--canvas-subtle);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    font-size: 12px;
  }
  .comment-block .ann-body pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }
  .comment-block .ann-body table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
    overflow-x: auto;
    display: block;
  }
  .comment-block .ann-body th,
  .comment-block .ann-body td {
    border: 1px solid var(--border-default);
    padding: 4px 10px;
    text-align: left;
  }
  .comment-block .ann-body th { background: var(--canvas-subtle); font-weight: 600; }
  .comment-block .ann-body del { color: var(--fg-muted); }
  .comment-block .ann-body hr {
    border: none;
    border-top: 1px solid var(--border-muted);
    margin: 12px 0;
  }
  .comment-block .ann-body .mermaid-block {
    margin: 8px 0;
  }
  .comment-block .ann-body .mermaid-block svg {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .comment-block .ann-body .mermaid-loading {
    color: var(--fg-muted);
    font-style: italic;
    font-size: 12px;
    padding: 8px 0;
  }
  .comment-block .ann-body .mermaid-failed .mermaid-error-header {
    color: var(--fg-danger);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .sequence-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--canvas-subtle);
    border: 1px solid var(--border-default);
    border-radius: 999px;
    padding: 4px 8px;
    color: var(--fg-default);
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .sequence-pill .pill-chevron {
    background: transparent;
    border: none;
    color: var(--fg-default);
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 4px;
  }
  .sequence-pill .pill-chevron:hover:not(:disabled) { background: var(--bg-accent-cursor); }
  .sequence-pill .pill-chevron:disabled { color: var(--fg-subtle); cursor: default; }
  .sequence-pill .pill-position { padding: 0 4px; min-width: 40px; text-align: center; }
  .empty {
    text-align: center;
    padding: 48px;
    padding-top: 16px;
    color: var(--fg-muted);
  }
  .picker-scrim {
    position: fixed;
    inset: 0;
    background: var(--shadow-scrim);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 30;
  }
  .picker-card {
    width: min(560px, 90vw);
    max-height: 70vh;
    background: var(--canvas-subtle);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--shadow-large);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .picker-card:focus { outline: none; }
  .picker-list {
    overflow-y: auto;
    padding: 4px 0;
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--fg-default);
    text-align: left;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  .picker-row.current { background: var(--bg-accent-current); }
  .picker-row.cursor { background: var(--bg-accent-cursor); border-left-color: var(--border-accent); }
  .picker-row.current.cursor { background: var(--bg-accent-cursor); border-left-color: var(--border-accent); }
  .picker-glyph { width: 12px; flex-shrink: 0; font-size: 11px; }
  .picker-glyph.open { color: var(--fg-success); }
  .picker-glyph.closed { color: var(--fg-muted); }
  .picker-age {
    color: var(--fg-muted);
    font-size: 11px;
    width: 64px;
    flex-shrink: 0;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .picker-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
</head>
<body>
<div id="root"></div>
<script>window.__INITIAL_TOUR_ID__ = ${initialId}; window.__INITIAL_REPLY_AGENT__ = ${initialReplyAgent};</script>
<script type="module" src="/client.js"></script>
</body>
</html>`;
}
