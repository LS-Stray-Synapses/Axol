// App state. The heart of it is `reduce`: a pure function (state, event) →
// state. Pure means easy to test (no DOM, no socket) and easy to reason about:
// the chat on screen is exactly the fold of every event received so far.
//
// The Zustand store holds only data, no action functions, because plugins get
// a read hook over it (see plugins.ts) and shouldn't find anything callable in
// there. Mutations go through the exported functions below.

import { create } from "zustand";
import type { ServerEvent } from "./contract";
import type { Block, ChatMessage, ConnectionState, PluginInfo, PublicState } from "../plugin-api";

export interface ChatState extends PublicState {
  /** id of the assistant message that is still receiving events, if any */
  openTurnId: string | null;
  /** user pressed Stop; the next `done` marks the turn as stopped */
  cancelRequested: boolean;
  /** list of models the backend exposed */
  models: Array<{ name: string; label: string }>;
  /** currently selected model name */
  selectedModel: string;
}

export const initialState: ChatState = {
  connection: "closed",
  running: false,
  messages: [],
  usage: undefined,
  plugins: {},
  openTurnId: null,
  cancelRequested: false,
  models: [],
  selectedModel: "",
};

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${++idCounter}`;

// ---------------------------------------------------------------- the reducer

/** Return a copy of state where the open assistant message was transformed by `fn`. */
function updateTurn(state: ChatState, fn: (m: ChatMessage) => ChatMessage): ChatState {
  if (state.openTurnId) {
    const i = state.messages.findIndex((m) => m.id === state.openTurnId);
    if (i !== -1) {
      const messages = state.messages.slice();
      messages[i] = fn(messages[i]!);
      return { ...state, messages };
    }
  }
  // First assistant event of the turn: start a new message.
  const fresh: ChatMessage = { id: newId("a"), role: "assistant", blocks: [] };
  return { ...state, messages: [...state.messages, fn(fresh)], openTurnId: fresh.id };
}

const finishThinking = (blocks: Block[]): Block[] =>
  blocks.map((b) => (b.kind === "thinking" && !b.done ? { ...b, done: true } : b));

/** Append a streamed delta to the last block if it's the same kind, else start a new block. */
function appendDelta(blocks: Block[], kind: "thinking" | "text", text: string): Block[] {
  const last = blocks.at(-1);
  if (last && last.kind === kind && (kind === "text" || !(last as { done: boolean }).done)) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...blocks, kind === "text" ? { kind, text } : { kind, text, done: false }];
}

function closeTurn(state: ChatState, patch: Partial<ChatMessage>): ChatState {
  if (!state.openTurnId) return { ...state, cancelRequested: false };
  const closed = updateTurn(state, (m) => ({ ...m, ...patch, blocks: finishThinking(m.blocks) }));
  return { ...closed, openTurnId: null, cancelRequested: false };
}

export function reduce(state: ChatState, e: ServerEvent): ChatState {
  switch (e.type) {
    case "model_list":
      return {
        ...state,
        models: e.models,
        selectedModel: e.selected,
      };

    case "status": {
      const running = e.state === "running";
      const next = { ...state, running };
      return running ? next : closeTurn(next, state.cancelRequested ? { stopped: true } : {});
    }

    case "thinking":
      return updateTurn(state, (m) => ({ ...m, blocks: appendDelta(m.blocks, "thinking", e.text) }));

    case "text":
      return updateTurn(state, (m) => ({
        ...m,
        blocks: appendDelta(finishThinking(m.blocks), "text", e.text),
      }));

    case "tool_call":
      return updateTurn(state, (m) => {
        const blocks = finishThinking(m.blocks);
        const i = blocks.findIndex((b) => b.kind === "tool" && b.id === e.id);
        const card: Block = { kind: "tool", id: e.id, name: e.name, args: e.args, done: false, isError: false };
        if (i === -1) return { ...m, blocks: [...blocks, card] };
        const copy = blocks.slice();
        copy[i] = { ...(copy[i] as Extract<Block, { kind: "tool" }>), name: e.name, args: e.args };
        return { ...m, blocks: copy };
      });

    case "tool_result": {
      const messages = state.messages.slice();
      for (let mi = messages.length - 1; mi >= 0; mi--) {
        const msg = messages[mi]!;
        const bi = msg.blocks.findIndex((b) => b.kind === "tool" && b.id === e.id);
        if (bi === -1) continue;
        const blocks = msg.blocks.slice();
        blocks[bi] = { ...(blocks[bi] as Extract<Block, { kind: "tool" }>), done: true, isError: e.is_error, result: e.result };
        messages[mi] = { ...msg, blocks };
        return { ...state, messages };
      }
      return updateTurn(state, (m) => ({
        ...m,
        blocks: [...m.blocks, { kind: "tool", id: e.id, name: e.name, args: {}, done: true, isError: e.is_error, result: e.result }],
      }));
    }

    case "done":
      return closeTurn(
        { ...state, usage: e.usage ?? state.usage },
        { ...(e.usage ? { usage: e.usage } : {}), ...(state.cancelRequested ? { stopped: true } : {}) },
      );

    case "error":
      return closeTurn(
        updateTurn(state, (m) => ({ ...m, error: e.message })),
        state.cancelRequested ? { stopped: true } : {},
      );

    case "approval_request":
    case "operation_result":
    case "plugin_loaded":
    case "plugin_unloaded":
      return state;
  }
}

// ---------------------------------------------------------------- the store

export const useStore = create<ChatState>()(() => initialState);

// Events are queued and applied once per animation frame. A fast stream
// sends hundreds of tiny deltas per second; rendering (and re-parsing the
// markdown) for each one starves the browser. Batching caps it at one render
// per frame, however fast the events arrive.
let queue: ServerEvent[] = [];
let scheduled = false;

export function applyServerEvent(e: ServerEvent): void {
  queue.push(e);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    flushServerEvents();
  });
}

/** Apply queued events now. Other mutations call this first so ordering is preserved. */
export function flushServerEvents(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  useStore.setState((s) => batch.reduce(reduce, s), true);
}

export function addUserMessage(text: string): void {
  flushServerEvents();
  useStore.setState((s) => ({
    messages: [...s.messages, { id: newId("u"), role: "user", blocks: [{ kind: "text", text }] }],
    openTurnId: null,
  }));
}

export function setConnectionState(connection: ConnectionState): void {
  flushServerEvents();
  useStore.setState((s) => {
    if (connection !== "open" && s.running) {
      return closeTurn({ ...s, connection, running: false }, { error: "connection lost" });
    }
    return { ...s, connection };
  }, true);
}

export function markCancelRequested(): void {
  flushServerEvents();
  useStore.setState({ cancelRequested: true });
}

export function setSelectedModel(model: string): void {
  useStore.setState({ selectedModel: model });
}

export function setPluginInfo(name: string, info: PluginInfo | null): void {
  useStore.setState((s) => {
    const plugins = { ...s.plugins };
    if (info) plugins[name] = info;
    else delete plugins[name];
    return { plugins };
  });
}

export function resetChat(): void {
  flushServerEvents();
  useStore.setState({ messages: [], openTurnId: null, cancelRequested: false, usage: undefined });
}