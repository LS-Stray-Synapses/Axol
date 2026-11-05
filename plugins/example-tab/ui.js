// @ts-check
// Example plugin: plain JavaScript, no build step. The back end serves this
// file at /plugins/example-tab/ui.js and sends
//   {"type": "plugin_loaded", "name": "example-tab", "ui_url": "/plugins/example-tab/ui.js"}
// The browser import()s it and calls activate(harness).
//
// Typecheck (from web/):  npx tsc --noEmit --ignoreConfig --allowJs --checkJs ../plugins/example-tab/ui.js

/** @typedef {import("../../web/plugin-api").Harness} Harness */
/** @typedef {import("../../web/plugin-api").ToolRendererProps} ToolRendererProps */

/** @param {Harness} harness */
export function activate(harness) {
  const { React, html, slots, callOperation, useStore, theme } = harness;

  // A sidebar tab that reads app state and calls a back-end operation.
  function ExampleTab() {
    const messageCount = useStore((s) => s.messages.length);
    const running = useStore((s) => s.running);
    const [echo, setEcho] = React.useState(/** @type {string | null} */ (null));

    async function ping() {
      try {
        const result = await callOperation("debug.echo", { hello: "from a plugin" });
        setEcho(JSON.stringify(result));
      } catch (err) {
        setEcho(`failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return html`
      <div data-example-tab style=${{ display: "grid", gap: "0.6rem" }}>
        <h3 style=${{ fontWeight: 600 }}>Example plugin</h3>
        <p style=${{ color: theme.muted }}>
          Loaded at runtime from plain JS. ${messageCount} messages so far${running ? ", agent running" : ""}.
        </p>
        <button
          onClick=${ping}
          style=${{ border: `1px solid ${theme.border}`, borderRadius: "6px", padding: "0.3rem 0.6rem", color: theme.fg }}
        >
          callOperation("debug.echo")
        </button>
        ${echo && html`<pre style=${{ fontFamily: theme.mono, fontSize: "0.75rem", whiteSpace: "pre-wrap" }}>${echo}</pre>`}
      </div>
    `;
  }

  // A header button.
  function Badge() {
    return html`<span data-example-badge style=${{ fontSize: "0.75rem", color: theme.accent }}>example-tab ✓</span>`;
  }

  // A custom renderer for one tool: list_files results as a file list.
  /** @param {ToolRendererProps} props */
  function FileList({ done, isError, result }) {
    if (!done) return html`<div style=${{ color: theme.muted, fontSize: "0.85rem" }}>listing files…</div>`;
    if (isError) return html`<div style=${{ color: theme.danger }}>${String(result)}</div>`;
    const files = String(result).split("\n").filter(Boolean);
    return html`
      <div data-file-list style=${{ border: `1px solid ${theme.border}`, borderRadius: "6px", padding: "0.4rem 0.7rem", margin: "0.5rem 0" }}>
        <div style=${{ fontSize: "0.75rem", color: theme.muted }}>📁 workspace (${files.length} files)</div>
        <ul style=${{ fontFamily: theme.mono, fontSize: "0.85rem" }}>
          ${files.map((f) => html`<li key=${f}>📄 ${f}</li>`)}
        </ul>
      </div>
    `;
  }

  // Every register() returns an undo; the harness also records them, so
  // unloading the plugin removes all three without us doing anything.
  slots.register("sidebar.tabs", { id: "example", title: "Example", order: 50, render: ExampleTab });
  slots.register("header.actions", { id: "example-badge", render: Badge });
  slots.register("tool.renderer", { tool: "list_files", render: FileList });
}
