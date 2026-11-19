// Small readouts of how fast the model streamed: under each finished turn,
// live in the header while a turn runs, and as totals for the whole chat.

import type { TurnStats } from "../../plugin-api";
import { totals } from "../conversations";
import { formatCount, formatDuration, formatRate, useLiveStats, type Phase } from "../metrics";
import { useStore } from "../store";

const EST = "≈ counted from streamed deltas (about one token each); the server didn't report usage";

/** One line under an assistant message: model · tok/s · tokens · first token · duration · tools. */
export function TurnStatsLine({ stats }: { stats: TurnStats }) {
  const parts: Array<[string, string, string?]> = [];
  if (stats.model) parts.push(["model", stats.model]);
  if (stats.tokensPerSecond !== undefined) parts.push(["tps", `${formatRate(stats.tokensPerSecond)} tok/s`, "tokens per second while streaming (tool time excluded)"]);
  parts.push([
    "tokens",
    `${stats.estimated ? "≈" : ""}${formatCount(stats.outputTokens)} tok`,
    stats.estimated ? EST : "output tokens reported by the server",
  ]);
  if (stats.thinkingTokens > 0) parts.push(["thinking", `${formatCount(stats.thinkingTokens)} thinking`, "of which thinking deltas"]);
  if (stats.ttftMs !== undefined) parts.push(["ttft", `first token ${formatDuration(stats.ttftMs)}`, "time from send to the first streamed token"]);
  parts.push(["duration", formatDuration(stats.durationMs), `whole turn, started ${new Date(stats.startedAt).toLocaleTimeString()}`]);
  if (stats.toolCalls > 0) parts.push(["tools", `${stats.toolCalls} tool${stats.toolCalls === 1 ? "" : "s"}`]);

  return (
    <div data-turn-stats className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-muted">
      {parts.flatMap(([key, text, title], i) => [
        i > 0 && <span key={`${key}-sep`} aria-hidden className="opacity-50">·</span>,
        <span key={key} data-stat={key} title={title}>{text}</span>,
      ])}
    </div>
  );
}

const PHASE: Record<Phase, string> = {
  waiting: "waiting for first token",
  thinking: "thinking",
  writing: "writing",
  tool: "running tool",
};

/** Header readout while a turn runs. */
export function LiveStats() {
  const live = useLiveStats((s) => s.live);
  if (!live) return null;
  return (
    <span data-live-stats className="shrink-0 font-mono text-xs text-muted" title={EST}>
      <span className="text-accent">{PHASE[live.phase]}</span>
      {" · "}
      {formatRate(live.tokensPerSecond)} tok/s · {formatCount(live.tokens)} tok · {formatDuration(live.elapsedMs)}
    </span>
  );
}

/** Totals for the open chat, for the bar above it. */
export function ConversationTotals() {
  const messages = useStore((s) => s.messages);
  const t = totals(messages);
  if (t.turns === 0) return null;
  return (
    <span data-conversation-totals className="shrink-0 font-mono text-[11px] text-muted" title={t.estimated ? EST : undefined}>
      {t.turns} turn{t.turns === 1 ? "" : "s"} · {t.estimated ? "≈" : ""}
      {formatCount(t.outputTokens)} tok
      {t.tokensPerSecond !== undefined && <> · avg {formatRate(t.tokensPerSecond)} tok/s</>}
      {t.toolCalls > 0 && <> · {t.toolCalls} tools</>}
    </span>
  );
}
