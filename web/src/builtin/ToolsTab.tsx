import { useOperation } from "./useOperation";

interface ToolInfo {
  name: string;
  description: string;
  origin?: string;
}

// Accept both {name, description, origin} and the raw OpenAI tool schema
// (OpenAI-style) a harness typically keeps ({type:"function", function:{name,…}}),
// so the real back end can return whichever is easier.
function parseTools(raw: unknown): ToolInfo[] {
  if (!Array.isArray(raw)) throw new Error("tools.list did not return a list");
  return raw.map((t: Record<string, unknown>) => {
    const fn = (t?.function ?? t) as Record<string, unknown>;
    return {
      name: String(fn?.name ?? "?"),
      description: String(fn?.description ?? ""),
      ...(typeof t?.origin === "string" ? { origin: t.origin } : {}),
    };
  });
}

export function ToolsTab() {
  const [state, refresh] = useOperation("tools.list", parseTools);
  return (
    <div data-tools-tab>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">Tools</h3>
        <button type="button" onClick={refresh} className="text-xs text-muted hover:text-fg">
          refresh
        </button>
      </div>
      {state.status === "loading" && <p className="text-muted">loading…</p>}
      {state.status === "error" && <p className="text-danger">{state.error}</p>}
      {state.status === "ok" && (
        <ul className="space-y-2">
          {state.data.map((t) => (
            <li key={t.name} className="rounded border border-border bg-bg/40 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium">{t.name}</span>
                {t.origin && <span className="rounded bg-raised px-1 text-[10px] uppercase text-muted">{t.origin}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">{t.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
