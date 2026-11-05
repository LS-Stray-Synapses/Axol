// @ts-check
// A deliberately broken plugin: its tab throws while rendering. The harness
// should show a small error box in that tab, report a plugin_error to the
// back end, and keep everything else working.

/** @param {import("../../web/plugin-api").Harness} harness */
export function activate(harness) {
  const { html, slots } = harness;

  /** @returns {ReturnType<typeof html>} */
  function Broken() {
    throw new Error("crash-tab exploded while rendering (on purpose)");
  }

  slots.register("sidebar.tabs", { id: "crash", title: "Crash", order: 60, render: Broken });
  // A healthy entry from the same plugin, to show only the broken one is replaced.
  slots.register("header.actions", { id: "crash-ok", render: () => html`<span data-crash-ok style=${{ fontSize: "0.75rem" }}>crash-tab loaded</span>` });
}
