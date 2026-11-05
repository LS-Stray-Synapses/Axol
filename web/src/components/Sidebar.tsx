import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { SlotBoundary, useSlot } from "../slots";
import { Popover } from "./Popover";

/** True when the element's content is wider than the element (i.e. it scrolls sideways). */
function useOverflowing(ref: RefObject<HTMLElement | null>, deps: unknown[]): boolean {
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return; // jsdom in unit tests
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // `deps` from the caller: re-measure when the set of tabs changes, since
    // adding a tab changes scrollWidth without resizing the strip itself.
  }, deps);
  return over;
}

/** Tabs come entirely from the `sidebar.tabs` slot; built-ins have no special path. */
export function Sidebar() {
  const tabs = useSlot("sidebar.tabs");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // If the active tab was unregistered (plugin unloaded), fall back to the first.
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  // Keep-alive: a tab is mounted the first time it's shown and then stays
  // mounted (just hidden), so its state - a half-typed form, fetched data -
  // survives switching tabs. Tabs that are never opened never mount.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (active && !visited.has(active.key)) setVisited((v) => new Set(v).add(active.key));
  }, [active, visited]);
  const mounted = tabs.filter((t) => t === active || visited.has(t.key));

  // One row that scrolls sideways; a ▾ menu lists every tab once they don't fit.
  const strip = useRef<HTMLElement>(null);
  const overflowing = useOverflowing(strip, [tabs.length]);
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active?.key]);

  return (
    <aside data-sidebar className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex shrink-0 items-center border-b border-border">
        <nav
          ref={strip}
          role="tablist"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto p-2 [scrollbar-width:thin]"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-tab={t.entry.id}
              title={t.entry.title}
              aria-selected={t === active}
              onClick={() => setActiveKey(t.key)}
              className={`max-w-40 shrink-0 truncate rounded px-2.5 py-1 text-sm ${
                t === active ? "bg-raised text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {t.entry.title}
            </button>
          ))}
        </nav>
        {overflowing && (
          <div className="pr-1.5">
            <Popover label="▾" title="all tabs" data-testid="tab-menu">
              {(close) =>
                tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveKey(t.key);
                      close();
                    }}
                    className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-raised ${
                      t === active ? "text-fg" : "text-muted"
                    }`}
                  >
                    {t.entry.title}
                  </button>
                ))
              }
            </Popover>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {mounted.length === 0 && <p className="text-muted">No tabs registered.</p>}
        {mounted.map((t) => (
          <div key={t.key} role="tabpanel" data-tab-panel={t.entry.id} hidden={t !== active}>
            {/* Each tab gets its own boundary: one crashing tab never takes down another. */}
            <SlotBoundary reg={t}>
              <t.entry.render />
            </SlotBoundary>
          </div>
        ))}
      </div>
    </aside>
  );
}
