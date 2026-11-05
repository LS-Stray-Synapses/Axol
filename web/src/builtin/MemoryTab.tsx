import { Markdown } from "../components/Markdown";
import { useOperation } from "./useOperation";

const asText = (raw: unknown) => (typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));

/** Shows memory.md via callOperation("memory.read"), the same way a plugin would. */
export function MemoryTab() {
  const [state, refresh] = useOperation("memory.read", asText);
  return (
    <div data-memory-tab>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">Long-term memory</h3>
        <button type="button" onClick={refresh} className="text-xs text-muted hover:text-fg">
          refresh
        </button>
      </div>
      {state.status === "loading" && <p className="text-muted">loading…</p>}
      {state.status === "error" && <p className="text-danger">{state.error}</p>}
      {state.status === "ok" && (state.data.trim() ? <Markdown text={state.data} /> : <p className="text-muted">(empty)</p>)}
    </div>
  );
}
