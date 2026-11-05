import { describe, expect, it } from "vitest";
import { parseServerEvent, parseServerFrame } from "../../src/contract";

describe("contract validation", () => {
  it.each([
    { type: "status", state: "running" },
    { type: "thinking", text: "" },
    { type: "text", text: "hi" },
    { type: "tool_call", id: "1", name: "read_file", args: { filename: "a" } },
    { type: "tool_result", id: "1", name: "read_file", result: "ok", is_error: false },
    { type: "tool_result", id: "1", name: "x", result: { rich: true }, is_error: true },
    { type: "approval_request", id: "1", tool: "write_file", args: {}, reason: "why" },
    { type: "done" },
    { type: "done", usage: { input_tokens: 1, output_tokens: 2 } },
    { type: "error", message: "boom" },
    { type: "operation_result", request_id: "r", ok: true, result: [1] },
    { type: "operation_result", request_id: "r", ok: false, error: "nope" },
    { type: "plugin_loaded", name: "p", ui_url: "/plugins/p/ui.js" },
    { type: "plugin_unloaded", name: "p" },
  ])("accepts $type", (event) => {
    expect(parseServerEvent(event)).toEqual({ ok: true, event });
  });

  it.each([
    [null, "not a JSON object"],
    [[1, 2], "not a JSON object"],
    [{ text: "no type" }, "no string 'type'"],
    [{ type: "nope" }, "unknown event type 'nope'"],
    [{ type: "text" }, "field 'text'"],
    [{ type: "status", state: "sleeping" }, "field 'state'"],
    [{ type: "tool_call", id: "1", name: "x", args: [] }, "field 'args'"],
    [{ type: "tool_result", id: "1", name: "x", is_error: false }, "field 'result'"],
    [{ type: "done", usage: { input_tokens: "1" } }, "field 'usage'"],
    [{ type: "plugin_loaded", name: "p", ui_url: "https://evil.example/x.js" }, "field 'ui_url'"],
    [{ type: "plugin_loaded", name: "p", ui_url: "/src/main.tsx" }, "field 'ui_url'"],
    [{ type: "__proto__" }, "unknown event type"],
  ])("rejects %j", (raw, why) => {
    const r = parseServerEvent(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(why);
  });

  it("rejects invalid JSON frames without throwing", () => {
    expect(parseServerFrame("{nope")).toEqual({ ok: false, error: "frame is not valid JSON" });
  });
});
