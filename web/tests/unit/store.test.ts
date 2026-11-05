import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../../src/contract";
import { initialState, reduce, type ChatState } from "../../src/store";

const fold = (events: ServerEvent[], from: ChatState = initialState) => events.reduce(reduce, from);

describe("reduce", () => {
  it("merges streamed text deltas into one assistant message with one block", () => {
    const s = fold([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo " },
      { type: "text", text: "world" },
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.blocks).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  it("closes the thinking block when the answer starts", () => {
    const s = fold([
      { type: "thinking", text: "hmm " },
      { type: "thinking", text: "ok" },
      { type: "text", text: "Answer" },
    ]);
    expect(s.messages[0]!.blocks).toEqual([
      { kind: "thinking", text: "hmm ok", done: true },
      { kind: "text", text: "Answer" },
    ]);
  });

  it("updates one tool card for tool_call + tool_result with the same id", () => {
    const s = fold([
      { type: "tool_call", id: "c1", name: "read_file", args: { filename: "a" } },
      { type: "tool_call", id: "c1", name: "read_file", args: { filename: "a" } }, // duplicate
      { type: "tool_result", id: "c1", name: "read_file", result: "data", is_error: false },
    ]);
    const tools = s.messages[0]!.blocks.filter((b) => b.kind === "tool");
    expect(tools).toEqual([
      { kind: "tool", id: "c1", name: "read_file", args: { filename: "a" }, done: true, isError: false, result: "data" },
    ]);
  });

  it("keeps a tool_result with no matching call instead of dropping it", () => {
    const s = fold([{ type: "tool_result", id: "x", name: "t", result: "orphan", is_error: true }]);
    expect(s.messages[0]!.blocks[0]).toMatchObject({ kind: "tool", id: "x", done: true, isError: true });
  });

  it("done records usage and the next turn starts a new message", () => {
    const s = fold([
      { type: "text", text: "one" },
      { type: "done", usage: { input_tokens: 5, output_tokens: 7 } },
      { type: "text", text: "two" },
    ]);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]!.usage).toEqual({ input_tokens: 5, output_tokens: 7 });
    expect(s.usage).toEqual({ input_tokens: 5, output_tokens: 7 });
  });

  it("error attaches to the turn and closes it", () => {
    const s = fold([{ type: "text", text: "partial" }, { type: "error", message: "boom" }]);
    expect(s.messages[0]).toMatchObject({ error: "boom" });
    expect(s.openTurnId).toBeNull();
  });

  it("status tracks running; idle after a cancel marks the turn stopped", () => {
    let s = fold([{ type: "status", state: "running" }, { type: "text", text: "chunk" }]);
    expect(s.running).toBe(true);
    s = { ...s, cancelRequested: true };
    s = fold([{ type: "status", state: "idle" }], s);
    expect(s.running).toBe(false);
    expect(s.messages[0]!.stopped).toBe(true);
    expect(s.cancelRequested).toBe(false);
  });

  it("ignores events that belong to other modules", () => {
    const events: ServerEvent[] = [
      { type: "approval_request", id: "a", tool: "t", args: {}, reason: "" },
      { type: "plugin_loaded", name: "p", ui_url: "/plugins/p.js" },
      { type: "operation_result", request_id: "r", ok: true },
    ];
    expect(fold(events)).toBe(initialState);
  });
});
