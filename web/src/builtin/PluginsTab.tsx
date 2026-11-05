// Lists the plugins the server knows about and lets you load / reload /
// unload them. The server stays in charge: buttons call operations
// (plugins.load / plugins.unload) and the server answers with the usual
// plugin_loaded / plugin_unloaded events, so this tab and the chat-driven
// scenarios can't disagree about what's loaded.

import { useEffect, useRef, useState } from "react";
import type { PluginInfo } from "../../plugin-api";
import { callOperation } from "../backend";
import { unloadPlugin } from "../plugins";
import { useStore } from "../store";
import { useOperation } from "./useOperation";

interface Available {
  name: string;
}

function parseList(raw: unknown): Available[] {
  if (!Array.isArray(raw)) throw new Error("plugins.list did not return a list");
  return raw.filter((p) => typeof p?.name === "string").map((p: { name: string }) => ({ name: p.name }));
}

const STATUS_STYLE: Record<PluginInfo["status"] | "off", string> = {
  active: "text-ok",
  loading: "text-accent",
  error: "text-danger",
  off: "text-muted",
};

export function PluginsTab() {
  const loaded = useStore((s) => s.plugins);
  const [list, refresh] = useOperation("plugins.list", parseList);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The server's list includes a "loaded" flag, so re-ask whenever the set of
  // loaded plugins changes (skipping the first render: useOperation already asked).
  const loadedKey = Object.keys(loaded).sort().join(",");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh();
  }, [loadedKey, refresh]);

  // Everything on disk, plus anything loaded that the server didn't list
  // (or everything loaded, if the server can't list at all).
  const names = new Set<string>([...(list.status === "ok" ? list.data.map((p) => p.name) : []), ...Object.keys(loaded)]);
  const serverCanList = list.status === "ok";

  async function act(name: string, op: "plugins.load" | "plugins.unload") {
    setBusy(name);
    setNote(null);
    try {
      await callOperation(op, { name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (op === "plugins.unload" && loaded[name]) {
        // The server can't do it (e.g. an early real back end without this
        // operation). Remove it from this page anyway; the server still
        // thinks it's loaded, so it may come back after a reconnect.
        unloadPlugin(name);
        setNote(`Server couldn't unload '${name}' (${msg}); removed in this browser only.`);
      } else {
        setNote(`${op} '${name}' failed: ${msg}`);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-plugins-tab>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">Plugins</h3>
        <button type="button" onClick={refresh} className="text-xs text-muted hover:text-fg">
          refresh
        </button>
      </div>

      {list.status === "error" && (
        <p className="mb-2 text-xs text-muted">Server can't list plugins ({list.error}). Showing loaded ones only.</p>
      )}
      {note && (
        <p role="status" className="mb-2 text-xs text-danger">
          {note}
        </p>
      )}
      {list.status === "loading" && names.size === 0 && <p className="text-muted">loading…</p>}
      {list.status !== "loading" && names.size === 0 && <p className="text-muted">No plugins in plugins/.</p>}

      <ul className="space-y-2">
        {[...names].sort().map((name) => {
          const info = loaded[name];
          const status = info?.status ?? "off";
          return (
            <li key={name} data-plugin-row={name} className="rounded border border-border bg-bg/40 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{name}</span>
                <span data-plugin-status className={`text-[11px] ${STATUS_STYLE[status]}`}>
                  {status === "off" ? "not loaded" : status}
                </span>
              </div>
              {info?.error && <p className="mt-1 text-xs text-danger">{info.error}</p>}
              <div className="mt-1.5 flex gap-1.5 text-xs">
                {info ? (
                  <>
                    <PluginButton label="Unload" disabled={busy !== null} onClick={() => act(name, "plugins.unload")} />
                    {serverCanList && (
                      <PluginButton label="Reload" disabled={busy !== null} onClick={() => act(name, "plugins.load")} />
                    )}
                  </>
                ) : (
                  <PluginButton label="Load" disabled={busy !== null || !serverCanList} onClick={() => act(name, "plugins.load")} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PluginButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-plugin-action={label.toLowerCase()}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border px-2 py-0.5 text-muted hover:border-accent hover:text-fg disabled:opacity-40"
    >
      {label}
    </button>
  );
}
