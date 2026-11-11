import { useOperation } from "./useOperation";

function parseFiles(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("workspace.list did not return a list");
  return raw.filter((x): x is string => typeof x === "string");
}

export function WorkspaceTab() {
  const [state, refresh] = useOperation("workspace.list", parseFiles);

  return (
    <div data-workspace-tab>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">Workspace</h3>
        <button type="button" onClick={refresh} className="text-xs text-muted hover:text-fg">
          refresh
        </button>
      </div>

      {state.status === "loading" && <p className="text-muted">loading…</p>}
      {state.status === "error" && <p className="text-danger">{state.error}</p>}

      {state.status === "ok" && (
        <ul className="space-y-2">
          {state.data.map((file) => (
            <li key={file}>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("workspace.open", { detail: { file } }));
                }}
                className="w-full rounded border border-border bg-bg/40 px-2 py-1.5 text-left text-xs font-mono text-muted hover:text-fg"
              >
                {file}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}