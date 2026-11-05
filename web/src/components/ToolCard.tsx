import type { ToolRendererProps } from "../../plugin-api";
import { useApprovals } from "../approvals";
import { SlotBoundary, useToolRenderer } from "../slots";

/** Results usually come back as strings from the harness, but don't assume it. */
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function DefaultToolCard({ id, name, args, done, isError, result }: ToolRendererProps) {
  const awaitingApproval = useApprovals((s) => s.pending.some((p) => p.id === id));
  const argText = Object.keys(args).length ? formatValue(args) : "";

  return (
    <div
      data-tool-card
      className={`my-2 rounded-md border text-sm ${isError ? "border-danger/70 bg-danger/5" : "border-border bg-panel"}`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono font-medium">{name}</span>
        {!done && <span className="h-spinner" aria-label="running" />}
        {!done && awaitingApproval && <span className="text-xs text-accent">waiting for approval</span>}
        {done && (
          <span className={`text-xs ${isError ? "text-danger" : "text-ok"}`}>{isError ? "✗ error" : "✓ done"}</span>
        )}
      </div>
      {argText && (
        <pre className="overflow-x-auto border-t border-border/60 px-3 py-1.5 font-mono text-xs text-muted">{argText}</pre>
      )}
      {done && (
        <details open={isError} className="border-t border-border/60">
          <summary className="cursor-pointer px-3 py-1 text-xs text-muted">result</summary>
          <pre
            data-tool-result
            className={`max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-2 font-mono text-xs ${isError ? "text-danger" : ""}`}
          >
            {formatValue(result)}
          </pre>
        </details>
      )}
    </div>
  );
}

/** Uses a plugin's renderer for this tool if one is registered, else the default card. */
export function ToolCard(props: ToolRendererProps) {
  const reg = useToolRenderer(props.name);
  if (!reg) {
    return (
      <div data-tool-id={props.id}>
        <DefaultToolCard {...props} />
      </div>
    );
  }
  const Renderer = reg.entry.render;
  return (
    <div data-tool-id={props.id}>
      {/* If the custom renderer crashes, fall back to the default card so the result isn't lost. */}
      <SlotBoundary key={reg.key} reg={reg} fallback={<DefaultToolCard {...props} />}>
        <Renderer {...props} />
      </SlotBoundary>
    </div>
  );
}
