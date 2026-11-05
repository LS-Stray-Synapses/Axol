// @ts-check
// The healthy twin of crash-tab: same shape (a sidebar tab + a header entry),
// but the tab works. Its header button breaks the tab on purpose, so you can
// watch one entry crash while the other keeps working, then fix it and retry.

/** @param {import("../../web/plugin-api").Harness} harness */
export function activate(harness) {
  const { React, html, slots, theme } = harness;

  // A tiny shared store, so the header button and the tab (two separate
  // slot entries) can see the same "broken" flag.
  let broken = false;
  const listeners = new Set();
  const store = {
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => broken,
    /** @param {boolean} value */
    set(value) {
      broken = value;
      listeners.forEach((fn) => fn());
    },
  };
  const useBroken = () => React.useSyncExternalStore(store.subscribe, store.get);

  function HealthyTab() {
    const isBroken = useBroken();
    const [clicks, setClicks] = React.useState(0);
    if (isBroken) throw new Error("healthy-tab was broken on purpose (press 🔧 fix tab, then retry)");
    return html`
      <div data-healthy-tab style=${{ display: "grid", gap: "0.6rem" }}>
        <h3 style=${{ fontWeight: 600 }}>Healthy plugin</h3>
        <p style=${{ color: theme.muted }}>
          Same structure as crash-tab, but this tab renders. Its state (the counter) survives switching tabs.
        </p>
        <button
          data-healthy-count
          onClick=${() => setClicks(clicks + 1)}
          style=${{ border: `1px solid ${theme.border}`, borderRadius: "6px", padding: "0.3rem 0.6rem" }}
        >
          clicked ${clicks} times
        </button>
      </div>
    `;
  }

  function BreakButton() {
    const isBroken = useBroken();
    return html`
      <button
        data-healthy-toggle
        onClick=${() => store.set(!isBroken)}
        title=${isBroken ? "let the tab render again (then press retry in the tab)" : "make the healthy tab throw"}
        style=${{
          fontSize: "0.75rem",
          padding: "0.1rem 0.5rem",
          borderRadius: "6px",
          border: `1px solid ${isBroken ? theme.ok : theme.danger}`,
          color: isBroken ? theme.ok : theme.danger,
        }}
      >
        ${isBroken ? "🔧 fix tab" : "💥 break tab"}
      </button>
    `;
  }

  slots.register("sidebar.tabs", { id: "healthy", title: "Healthy", order: 60, render: HealthyTab });
  slots.register("header.actions", { id: "healthy-toggle", render: BreakButton });
}
