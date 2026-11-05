import { Slot } from "../slots";
import { useStore } from "../store";

/** Header entries shown inline; more than this go into a "⋯" menu. */
const HEADER_MAX = 4;

const DOT: Record<string, string> = {
  open: "bg-ok",
  connecting: "bg-accent animate-pulse",
  closed: "bg-danger",
};

export function Header() {
  const connection = useStore((s) => s.connection);
  const running = useStore((s) => s.running);
  const usage = useStore((s) => s.usage);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-4">
      <span className="shrink-0 font-semibold tracking-tight">Harness</span>
      <span data-connection={connection} className="flex items-center gap-1.5 text-xs text-muted">
        <span className={`inline-block size-2 rounded-full ${DOT[connection]}`} />
        {connection}
        {running && <span className="ml-2 text-accent">● running</span>}
      </span>
      <div className="flex-1" />
      {usage && (
        <span data-usage className="shrink-0 font-mono text-xs text-muted" title="tokens used by the last turn">
          in {usage.input_tokens.toLocaleString()} · out {usage.output_tokens.toLocaleString()}
        </span>
      )}
      <Slot name="header.actions" max={HEADER_MAX} className="flex shrink-0 items-center gap-2" />
    </header>
  );
}
