// Slots: named places in the fixed shell where built-ins and plugins can put
// UI. The registry is a tiny observable map; React subscribes to it with
// useSyncExternalStore so a register() or undo() re-renders exactly the slot
// that changed.

import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import type { SlotMap, SlotName, ToolRendererEntry, Undo } from "../plugin-api";
import { reportPluginError } from "./backend";
import { Popover } from "./components/Popover";
import { recordError } from "./diagnostics";

/** A registration as the registry stores it: the entry plus bookkeeping. */
export interface Registration<K extends SlotName = SlotName> {
  key: string; // unique per registration, used as the React key
  slot: K;
  owner: string; // "core" for built-ins, otherwise the plugin name
  entry: SlotMap[K];
  seq: number; // registration order, the tie-breaker for equal `order`
}

// List slots render every entry; keyed slots render one entry per key.
const KEYED: { [K in SlotName]: boolean } = {
  "sidebar.tabs": false,
  "header.actions": false,
  "composer.actions": false,
  "tool.renderer": true,
};

// Each slot holds an immutable array that is *replaced* on change. That gives
// useSyncExternalStore a stable snapshot to compare by identity.
const registry = new Map<SlotName, readonly Registration[]>();
const listeners = new Set<() => void>();
let seq = 0;
const EMPTY: readonly Registration[] = [];

const orderOf = (r: Registration) => ("order" in r.entry ? (r.entry.order ?? 100) : 100);

function emit() {
  for (const l of listeners) l();
}

export function register<K extends SlotName>(slot: K, entry: SlotMap[K], owner = "core"): Undo {
  if (!(slot in KEYED)) {
    // The types prevent this for TS callers; plain-JS plugins can still try.
    throw new Error(`unknown slot '${String(slot)}'`);
  }
  if (typeof entry?.render !== "function") {
    // Would only crash later, at render time, far from the actual mistake.
    throw new Error(`${owner}: entry for '${slot}' needs a render function (a React component)`);
  }
  if (!KEYED[slot]) {
    // Duplicate ids still work (each registration has its own key), but two
    // identical-looking tabs or buttons are almost always a mistake, e.g. a
    // plugin activated twice or two plugins picking the same name. Warn, so
    // it shows up in getErrors() where the agent can notice it.
    const id = (entry as { id: string }).id;
    const clash = (registry.get(slot) ?? EMPTY).find((r) => "id" in r.entry && r.entry.id === id);
    if (clash) {
      recordError("plugin", `duplicate id '${id}' in ${slot}: already registered by '${clash.owner}', now also by '${owner}'`, {
        slot,
        id,
      });
    }
  }
  const reg: Registration<K> = { key: `${owner}:${++seq}`, slot, owner, entry, seq };
  const next = [...(registry.get(slot) ?? EMPTY), reg as Registration].sort(
    (a, b) => orderOf(a) - orderOf(b) || a.seq - b.seq,
  );
  registry.set(slot, next);
  emit();

  let undone = false;
  return () => {
    if (undone) return; // undo is idempotent
    undone = true;
    registry.set(slot, (registry.get(slot) ?? EMPTY).filter((r) => r !== reg));
    emit();
  };
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every registration in a slot, sorted. Re-renders the caller when it changes. */
export function useSlot<K extends SlotName>(slot: K): readonly Registration<K>[] {
  const get = () => (registry.get(slot) ?? EMPTY) as readonly Registration<K>[];
  return useSyncExternalStore(subscribe, get, get);
}

/** The renderer for one tool name: the most recent registration wins. */
export function useToolRenderer(tool: string): Registration<"tool.renderer"> | undefined {
  return useSlot("tool.renderer").findLast((r) => (r.entry as ToolRendererEntry).tool === tool);
}

/** For harnessDebug.listSlots(): what's registered where, by whom. */
export function listSlots(): Record<string, { id: string; order: number; plugin: string }[]> {
  const out: Record<string, { id: string; order: number; plugin: string }[]> = {};
  for (const slot of Object.keys(KEYED) as SlotName[]) {
    out[slot] = (registry.get(slot) ?? EMPTY).map((r) => ({
      id: "id" in r.entry ? r.entry.id : (r.entry as ToolRendererEntry).tool,
      order: orderOf(r),
      plugin: r.owner,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- error boundary

interface BoundaryProps {
  reg: Registration;
  children: ReactNode;
  /** shown under the error box, e.g. the default tool card when a custom renderer crashed */
  fallback?: ReactNode;
}

/**
 * Catches a crash in one entry so the rest of the UI survives. React only
 * supports this as a class component (there is no hook for it).
 */
export class SlotBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  retry = () => this.setState({ error: null });

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const { slot, owner } = this.props.reg;
    const message = error instanceof Error ? error.message : String(error);
    recordError(owner === "core" ? "render" : "plugin", `${owner} crashed in ${slot}: ${message}`, {
      stack: info.componentStack,
    });
    reportPluginError(owner, slot, message);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { reg } = this.props;
    return (
      <>
        <div
          data-slot-error={reg.key}
          role="alert"
          className="rounded border border-danger/60 bg-danger/10 px-2 py-1 text-xs text-danger"
        >
          {reg.owner === "core" ? "This panel" : `Plugin “${reg.owner}”`} crashed: {this.state.error.message}{" "}
          {/* Tabs stay mounted now, so switching away no longer resets a crash; this does. */}
          <button type="button" onClick={this.retry} className="ml-1 underline hover:no-underline">
            retry
          </button>
        </div>
        {this.props.fallback}
      </>
    );
  }
}

function renderEntry(r: Registration<"header.actions" | "composer.actions">) {
  const Entry = r.entry.render;
  return (
    <SlotBoundary key={r.key} reg={r}>
      <Entry />
    </SlotBoundary>
  );
}

interface SlotProps {
  name: "header.actions" | "composer.actions";
  className?: string;
  /** Show at most this many entries inline (lowest `order` first); the rest go into a "⋯" menu. */
  max?: number;
  menuPlacement?: "down" | "up";
}

/** Render the entries of a list slot, each inside its own boundary. */
export function Slot({ name, className, max = Infinity, menuPlacement = "down" }: SlotProps) {
  const regs = useSlot(name);
  if (regs.length === 0) return null;
  // A cap instead of measuring widths: predictable, and a row of plugin
  // buttons can't push core UI (like the token counter) off the screen.
  const inline = regs.slice(0, max);
  const extra = regs.slice(max);
  return (
    <div className={className} data-slot={name}>
      {inline.map(renderEntry)}
      {extra.length > 0 && (
        <Popover label="⋯" title={`${extra.length} more`} placement={menuPlacement} data-testid={`${name}-more`}>
          {extra.map(renderEntry)}
        </Popover>
      )}
    </div>
  );
}

/** Test/debug hook: forget every registration. */
export function _resetSlots(): void {
  registry.clear();
  emit();
}
