// Turn timing: tokens per second, time to first token, duration.
//
// The back end sends no timing (and usually no `usage`), so we measure in the
// browser, timestamping each event as it comes off the socket (wiring.ts
// calls `track` before the store batches it into the next frame).
//
// Tokens: llama.cpp and Ollama stream about one token per delta, so counting
// thinking/text deltas is a good estimate. If `done` carries `usage`, that
// number wins and the stats are marked exact.
//
// Speed is measured only while the model is streaming. A turn alternates
// "model streams" and "tool runs"; time spent in tools (or waiting on an
// approval) says nothing about the model, so each run of deltas is one
// segment and tok/s = tokens / (sum of segment durations).

import { create } from "zustand";
import type { ServerEvent, Usage } from "./contract";
import type { TurnStats } from "../plugin-api";
import { flushServerEvents, setTurnStats, useStore } from "./store";

/** Segments shorter than this give silly rates (1 token / 0 ms), so don't report one. */
const MIN_DECODE_MS = 150;
/** How often the live readout refreshes while a turn runs. */
const LIVE_EVERY_MS = 250;

export type Phase = "waiting" | "thinking" | "writing" | "tool";

export interface LiveStats {
  phase: Phase;
  tokens: number;
  tokensPerSecond?: number;
  elapsedMs: number;
}

/** Live readout for the header. null between turns. */
export const useLiveStats = create<{ live: LiveStats | null }>()(() => ({ live: null }));

interface Turn {
  startedAt: number; // performance.now()
  startedAtEpoch: number;
  model?: string;
  phase: Phase;
  tokens: number;
  thinkingTokens: number;
  firstTokenAt?: number;
  // the open segment, if deltas are streaming right now
  segStart?: number;
  segLast?: number;
  decodeMs: number; // closed segments only
  toolCalls: number;
  usage?: Usage;
}

let turn: Turn | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

const now = () => performance.now();

function closeSegment(t: Turn) {
  if (t.segStart !== undefined && t.segLast !== undefined) t.decodeMs += t.segLast - t.segStart;
  t.segStart = t.segLast = undefined;
}

function rate(tokens: number, decodeMs: number): number | undefined {
  return decodeMs >= MIN_DECODE_MS ? tokens / (decodeMs / 1000) : undefined;
}

function publishLive() {
  if (!turn) return;
  const open = turn.segStart !== undefined && turn.segLast !== undefined ? turn.segLast - turn.segStart : 0;
  useLiveStats.setState({
    live: {
      phase: turn.phase,
      tokens: turn.tokens,
      tokensPerSecond: rate(turn.tokens, turn.decodeMs + open),
      elapsedMs: now() - turn.startedAt,
    },
  });
}

/** Start timing a turn. Called when the user sends, so TTFT includes the trip to the server. */
export function beginTurn(model?: string): void {
  clearInterval(timer);
  turn = {
    startedAt: now(),
    startedAtEpoch: Date.now(),
    model,
    phase: "waiting",
    tokens: 0,
    thinkingTokens: 0,
    decodeMs: 0,
    toolCalls: 0,
  };
  publishLive();
  timer = setInterval(publishLive, LIVE_EVERY_MS);
}

function finishTurn() {
  const t = turn;
  turn = null;
  clearInterval(timer);
  useLiveStats.setState({ live: null });
  if (!t) return;
  closeSegment(t);

  const outputTokens = t.usage?.output_tokens ?? t.tokens;
  const stats: TurnStats = {
    model: t.model,
    startedAt: t.startedAtEpoch,
    outputTokens,
    thinkingTokens: t.thinkingTokens,
    estimated: !t.usage,
    tokensPerSecond: rate(outputTokens, t.decodeMs),
    ttftMs: t.firstTokenAt !== undefined ? t.firstTokenAt - t.startedAt : undefined,
    durationMs: now() - t.startedAt,
    toolCalls: t.toolCalls,
  };

  // The turn's message is the last assistant one: there is only ever one
  // turn at a time, and conversations can't be switched while it runs.
  flushServerEvents();
  const last = useStore.getState().messages.at(-1);
  if (last?.role === "assistant") setTurnStats(last.id, stats);
}

/** Feed every validated server event through here, as it arrives. */
export function track(e: ServerEvent): void {
  switch (e.type) {
    case "status":
      if (e.state === "running" && !turn) beginTurn(useStore.getState().selectedModel || undefined);
      if (e.state === "idle") finishTurn();
      return;

    case "thinking":
    case "text": {
      if (!turn) return;
      const at = now();
      turn.tokens++;
      if (e.type === "thinking") turn.thinkingTokens++;
      turn.firstTokenAt ??= at;
      turn.segStart ??= at;
      turn.segLast = at;
      turn.phase = e.type === "thinking" ? "thinking" : "writing";
      return;
    }

    case "tool_call":
      if (!turn) return;
      closeSegment(turn);
      turn.toolCalls++;
      turn.phase = "tool";
      return;

    case "tool_result":
    case "approval_request":
      if (turn) closeSegment(turn);
      return;

    case "done":
      if (turn && e.usage) turn.usage = e.usage;
      finishTurn();
      return;

    case "error":
      finishTurn();
      return;

    default:
      return;
  }
}

/** The connection dropped: the turn is over, whatever it was doing. */
export function abandonTurn(): void {
  finishTurn();
}

// ---------------------------------------------------------------- formatting

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatRate(tps: number | undefined): string {
  return tps === undefined ? "–" : tps >= 100 ? tps.toFixed(0) : tps.toFixed(1);
}

export function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}
