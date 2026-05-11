import { themeCSSVars } from "../core/theme.js";

export function html(initialTourId?: string): string {
  const initialId = initialTourId ? JSON.stringify(initialTourId) : "null";
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
  .app-sidebar {
    width: 280px;
    border-right: 1px solid var(--border-default);
    overflow-y: auto;
    flex-shrink: 0;
  }
  .app-sidebar h2 {
    padding: 12px 16px;
    font-size: 14px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--border-default);
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
  .tour-header-path {
    color: var(--fg-muted);
    font-size: 13px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-basis: 100%;
    min-width: 0;
  }
  .tour-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
  }
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
  .annotation-block {
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
  .annotation-block.current {
    border-color: var(--border-accent);
    box-shadow: 0 2px 8px var(--shadow-medium);
  }
  .annotation-block .selection-marker { color: var(--fg-accent); font-weight: 700; }
  .annotation-block .ann-header {
    color: var(--fg-accent);
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .annotation-block .author-kind {
    text-transform: lowercase;
    font-weight: 700;
  }
  .annotation-block .author-kind.agent { color: var(--fg-muted); }
  .annotation-block .author-kind.human { color: var(--fg-accent); }
  .annotation-block .ann-replies {
    margin-top: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border-muted);
  }
  .annotation-block .ann-reply { margin-top: 8px; }
  .annotation-block .ann-reply:first-child { margin-top: 0; }
  .annotation-block .ann-actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .annotation-block .reply-button {
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    color: var(--fg-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
  }
  .annotation-block .reply-button:hover {
    background: var(--canvas-subtle);
    color: var(--fg-default);
  }
  .annotation-block .ann-reply-composer {
    margin-top: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--border-muted);
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
  .annotation-block .ann-body { color: var(--fg-default); overflow-wrap: anywhere; }
  .annotation-block .ann-body > * { margin: 0 0 8px; }
  .annotation-block .ann-body > *:last-child { margin-bottom: 0; }
  .annotation-block .ann-body h1,
  .annotation-block .ann-body h2,
  .annotation-block .ann-body h3,
  .annotation-block .ann-body h4,
  .annotation-block .ann-body h5,
  .annotation-block .ann-body h6 {
    font-weight: 600;
    line-height: 1.25;
    margin: 12px 0 6px;
    color: var(--fg-default);
  }
  .annotation-block .ann-body h1 { font-size: 1.4em; }
  .annotation-block .ann-body h2 { font-size: 1.25em; }
  .annotation-block .ann-body h3 { font-size: 1.1em; }
  .annotation-block .ann-body h4,
  .annotation-block .ann-body h5,
  .annotation-block .ann-body h6 { font-size: 1em; }
  .annotation-block .ann-body p { line-height: 1.5; }
  .annotation-block .ann-body ul,
  .annotation-block .ann-body ol { padding-left: 24px; line-height: 1.5; }
  .annotation-block .ann-body li { margin: 2px 0; }
  .annotation-block .ann-body li input[type="checkbox"] {
    margin-right: 6px;
    vertical-align: middle;
  }
  .annotation-block .ann-body blockquote {
    border-left: 3px solid var(--border-muted);
    padding: 0 12px;
    color: var(--fg-muted);
    margin: 8px 0;
  }
  .annotation-block .ann-body a { color: var(--fg-accent); text-decoration: none; }
  .annotation-block .ann-body a:hover { text-decoration: underline; }
  .annotation-block .ann-body code {
    background: var(--bg-neutral-subtle);
    border-radius: 3px;
    padding: 0.15em 0.35em;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9em;
  }
  .annotation-block .ann-body pre {
    background: var(--canvas-subtle);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    font-size: 12px;
  }
  .annotation-block .ann-body pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }
  .annotation-block .ann-body table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
    overflow-x: auto;
    display: block;
  }
  .annotation-block .ann-body th,
  .annotation-block .ann-body td {
    border: 1px solid var(--border-default);
    padding: 4px 10px;
    text-align: left;
  }
  .annotation-block .ann-body th { background: var(--canvas-subtle); font-weight: 600; }
  .annotation-block .ann-body del { color: var(--fg-muted); }
  .annotation-block .ann-body hr {
    border: none;
    border-top: 1px solid var(--border-muted);
    margin: 12px 0;
  }
  .annotation-block .ann-body .mermaid-block {
    margin: 8px 0;
  }
  .annotation-block .ann-body .mermaid-block svg {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .annotation-block .ann-body .mermaid-loading {
    color: var(--fg-muted);
    font-style: italic;
    font-size: 12px;
    padding: 8px 0;
  }
  .annotation-block .ann-body .mermaid-failed .mermaid-error-header {
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
<script>window.__INITIAL_TOUR_ID__ = ${initialId};</script>
<script type="module" src="/client.js"></script>
</body>
</html>`;
}
