import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as backend from "../../src/backend";
import type { SocketLike } from "../../src/backend";
import { getErrors } from "../../src/diagnostics";

/** A WebSocket stand-in we can drive from the test. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }
}

const latest = () => FakeSocket.all.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  backend.connect("ws://test/ws", (url) => new FakeSocket(url));
  latest().open();
});

afterEach(() => {
  backend.disconnect();
  vi.useRealTimers();
});

describe("backend", () => {
  it("delivers validated events and drops invalid ones into getErrors()", () => {
    const seen: unknown[] = [];
    const off = backend.onEvent((e) => seen.push(e));
    const errorsBefore = getErrors().length;

    latest().receive({ type: "text", text: "hi" });
    latest().receive("{not json");
    latest().receive({ type: "mystery" });
    latest().receive({ type: "text" });
    off();
    latest().receive({ type: "text", text: "after unsubscribe" });

    expect(seen).toEqual([{ type: "text", text: "hi" }]);
    expect(getErrors().length - errorsBefore).toBe(3);
  });

  it("a throwing subscriber doesn't stop the others", () => {
    const seen: string[] = [];
    const off1 = backend.onEvent(() => {
      throw new Error("bad handler");
    });
    const off2 = backend.onEvent((e) => seen.push(e.type));
    latest().receive({ type: "done" });
    off1();
    off2();
    expect(seen).toEqual(["done"]);
  });

  it("sends the contract's browser→server events", () => {
    backend.sendMessage("hello");
    backend.replyApproval("a1", true);
    backend.cancel();
    backend.reportPluginError("p", "sidebar.tabs", "boom");
    expect(latest().sent).toEqual([
      { type: "user_message", text: "hello" },
      { type: "approval_reply", id: "a1", approved: true },
      { type: "cancel" },
      { type: "plugin_error", name: "p", slot: "sidebar.tabs", error: "boom" },
    ]);
  });

  it("callOperation resolves on ok:true and rejects on ok:false", async () => {
    const good = backend.callOperation("memory.read");
    const bad = backend.callOperation("debug.fail", { x: 1 });
    const [r1, r2] = latest().sent as { request_id: string; name: string; args: unknown }[];
    expect(r1).toMatchObject({ type: "call_operation", name: "memory.read", args: {} });
    expect(r2).toMatchObject({ name: "debug.fail", args: { x: 1 } });
    expect(r1!.request_id).not.toBe(r2!.request_id);

    latest().receive({ type: "operation_result", request_id: r2!.request_id, ok: false, error: "nope" });
    latest().receive({ type: "operation_result", request_id: r1!.request_id, ok: true, result: "- fact" });
    await expect(good).resolves.toBe("- fact");
    await expect(bad).rejects.toThrow("nope");
  });

  it("callOperation times out after 10 s", async () => {
    const p = backend.callOperation("slow");
    const assertion = expect(p).rejects.toThrow("timed out");
    vi.advanceTimersByTime(10_001);
    await assertion;
  });

  it("callOperation rejects immediately when not connected", async () => {
    backend.disconnect();
    await expect(backend.callOperation("x")).rejects.toThrow("not connected");
    expect(backend.sendMessage("hi")).toBe(false);
  });

  it("reconnects with backoff after the server drops, and fails pending operations", async () => {
    const states: string[] = [];
    const off = backend.onConnectionChange((s) => states.push(s));
    const pending = backend.callOperation("x");
    const assertion = expect(pending).rejects.toThrow("connection closed");

    latest().close(); // server went away
    await assertion;
    expect(backend.getConnection()).toBe("closed");
    expect(FakeSocket.all).toHaveLength(1);

    vi.advanceTimersByTime(1_000); // first retry is ~500 ms (±25% jitter)
    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    expect(backend.getConnection()).toBe("open");
    expect(states).toEqual(["closed", "connecting", "open"]);
    off();
  });

  it("does not reconnect after an explicit disconnect()", () => {
    backend.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
