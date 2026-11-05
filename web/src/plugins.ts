// Runtime plugin loader. The back end says "plugin_loaded {name, ui_url}", we
// import() that URL and call its activate(harness). Everything the plugin
// registers goes through a wrapper that records the undo function, so
// unloading is just "run every undo this plugin created".

import React from "react";
import htm from "htm";
import type { Harness, PluginModule, PublicState, SlotMap, SlotName, ThemeTokens, Undo } from "../plugin-api";
import { callOperation, reportPluginError } from "./backend";
import { recordError } from "./diagnostics";
import { register } from "./slots";
import { setPluginInfo, useStore } from "./store";

export type Importer = (url: string) => Promise<unknown>;

const defaultImporter: Importer = (url) => import(/* @vite-ignore */ url);

// Live CSS variables rather than resolved colors, so plugins follow theme switches.
export const theme: ThemeTokens = {
  bg: "var(--h-bg)",
  panel: "var(--h-panel)",
  raised: "var(--h-raised)",
  border: "var(--h-border)",
  fg: "var(--h-fg)",
  muted: "var(--h-muted)",
  accent: "var(--h-accent)",
  danger: "var(--h-danger)",
  ok: "var(--h-ok)",
  font: "var(--h-font)",
  mono: "var(--h-mono)",
};

const html = htm.bind(React.createElement) as Harness["html"];

// Plugins get a read-only view: a selector over the data-only store. There is
// no setState and no approval state in here (see approvals.ts).
function usePluginStore<T>(selector: (s: PublicState) => T): T {
  return useStore((s) => selector(s));
}

interface Loaded {
  undos: Undo[];
  generation: number;
}
const loaded = new Map<string, Loaded>();
let generation = 0;

function runUndos(name: string, undos: Undo[]) {
  // Newest first, mirroring how they were stacked up.
  for (const undo of undos.reverse()) {
    try {
      undo();
    } catch (err) {
      recordError("plugin", `${name}: cleanup threw: ${String(err)}`, err);
    }
  }
}

export function unloadPlugin(name: string): void {
  const entry = loaded.get(name);
  if (!entry) return;
  loaded.delete(name);
  runUndos(name, entry.undos);
  setPluginInfo(name, null);
}

export async function loadPlugin(name: string, ui_url: string, importer: Importer = defaultImporter): Promise<void> {
  unloadPlugin(name); // reloading the same name replaces it cleanly

  const myGen = ++generation;
  const record: Loaded = { undos: [], generation: myGen };
  loaded.set(name, record);
  setPluginInfo(name, { name, ui_url, status: "loading" });
  // If an unload or a newer load of the same name happened while we awaited, stop.
  const stale = () => loaded.get(name)?.generation !== myGen;

  const harness: Harness = Object.freeze({
    name,
    React,
    html,
    slots: Object.freeze({
      register<K extends SlotName>(slot: K, entry: SlotMap[K]): Undo {
        if (stale()) throw new Error(`plugin '${name}' is no longer loaded`);
        const undo = register(slot, entry, name);
        record.undos.push(undo);
        return undo;
      },
    }),
    callOperation,
    useStore: usePluginStore,
    theme,
  });

  try {
    // Cache-buster: ES modules are cached by URL forever, so without it a
    // reload would re-run the old code. Matters once the agent edits plugins.
    const sep = ui_url.includes("?") ? "&" : "?";
    const mod = (await importer(`${ui_url}${sep}v=${Date.now()}`)) as Partial<PluginModule>;
    if (stale()) return;
    if (typeof mod?.activate !== "function") throw new Error("module has no exported activate(harness)");

    const cleanup = await mod.activate(harness);
    if (stale()) {
      if (typeof cleanup === "function") cleanup();
      return;
    }
    if (typeof cleanup === "function") record.undos.unshift(cleanup); // runs last
    setPluginInfo(name, { name, ui_url, status: "active" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError("plugin", `failed to load plugin '${name}': ${message}`, err);
    reportPluginError(name, "activate", message);
    if (stale()) return;
    // Undo whatever it managed to register before failing, but keep the
    // record so the UI can show the error.
    runUndos(name, record.undos.splice(0));
    setPluginInfo(name, { name, ui_url, status: "error", error: message });
  }
}

export function loadedPluginNames(): string[] {
  return [...loaded.keys()];
}
