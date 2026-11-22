import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "../../src/contract";
import {
  FIRST,
  UNTITLED,
  byOrder,
  deleteConversations,
  moveConversations,
  placeConversations,
  createFolder,
  deleteConversation,
  deleteFolder,
  initConversations,
  moveConversation,
  newConversation,
  relativeTime,
  renameConversation,
  switchConversation,
  titleFromFirstMessage,
  totals,
  useConversations,
} from "../../src/conversations";
import { abandonTurn, beginTurn, track, useLiveStats } from "../../src/metrics";
import { addUserMessage, applyServerEvent, flushServerEvents, initialState, useStore } from "../../src/store";

const KEY = "axol.conversations.v1";

/** An in-memory Storage, so each test starts clean and can inspect what was saved. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const send = (...events: ServerEvent[]) => {
  for (const e of events) {
    applyServerEvent(e);
    track(e);
  }
  flushServerEvents();
};

const active = () => useConversations.getState().conversations[useConversations.getState().activeId]!;
const all = () => Object.values(useConversations.getState().conversations);

let undo: () => void = () => {};

beforeEach(() => {
  useStore.setState(initialState, true);
});
afterEach(() => {
  abandonTurn(); // stop a turn a test left running (and its live-stats timer)
  undo();
  vi.restoreAllMocks();
});

describe("conversations", () => {
  it("starts with one empty chat and mirrors the chat store into it", () => {
    undo = initConversations(memoryStorage());
    expect(all()).toHaveLength(1);
    expect(active().title).toBe(UNTITLED);

    addUserMessage("hello");
    send({ type: "text", text: "hi there" }, { type: "done" });
    expect(active().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("names a chat after its first message, once", () => {
    undo = initConversations(memoryStorage());
    titleFromFirstMessage("  plan the week\nwith details");
    expect(active().title).toBe("plan the week");
    titleFromFirstMessage("something else");
    expect(active().title).toBe("plan the week");
    titleFromFirstMessage("x".repeat(200)); // still ignored: already titled
    renameConversation(active().id, "  Weekly plan ");
    expect(active().title).toBe("Weekly plan");
  });

  it("switches between chats, showing each one's own messages", () => {
    undo = initConversations(memoryStorage());
    const first = active().id;
    addUserMessage("one");
    expect(newConversation()).toBe(true);
    const second = active().id;
    expect(second).not.toBe(first);
    expect(useStore.getState().messages).toEqual([]);

    addUserMessage("two");
    switchConversation(first);
    expect(useStore.getState().messages.map((m) => m.blocks[0])).toEqual([{ kind: "text", text: "one" }]);
    switchConversation(second);
    expect(useStore.getState().messages.map((m) => m.blocks[0])).toEqual([{ kind: "text", text: "two" }]);
  });

  it("opens another chat on every click, numbering untitled ones", () => {
    undo = initConversations(memoryStorage());
    newConversation();
    newConversation();
    expect(all().map((c) => c.title).sort()).toEqual(["New chat", "New chat (1)", "New chat (2)"]);
    renameConversation(all().find((c) => c.title === "New chat (1)")!.id, "kept");
    newConversation();
    expect(active().title).toBe("New chat (1)");
    titleFromFirstMessage("from the click");
    expect(active().title).toBe("from the click");
  });

  it("won't switch, create or delete the open chat while a turn runs", () => {
    undo = initConversations(memoryStorage());
    addUserMessage("one");
    newConversation();
    const other = active().id;
    switchConversation(all().find((c) => c.id !== other)!.id);
    useStore.setState({ running: true });
    expect(switchConversation(other)).toBe(false);
    expect(newConversation()).toBe(false);
    expect(deleteConversation(active().id)).toBe(false);
    expect(deleteConversation(other)).toBe(true); // a background chat is fine
  });

  it("files chats in folders; deleting a folder keeps its chats", () => {
    undo = initConversations(memoryStorage());
    const f = createFolder("Research")!;
    expect(createFolder("   ")).toBeNull();
    moveConversation(active().id, f);
    expect(active().folderId).toBe(f);
    moveConversation(active().id, "no-such-folder");
    expect(active().folderId).toBe(f);
    deleteFolder(f);
    expect(useConversations.getState().folders).toEqual([]);
    expect(active().folderId).toBeNull();
    expect(all()).toHaveLength(1);
  });

  it("deleting the active chat opens the most recent other one", () => {
    undo = initConversations(memoryStorage());
    addUserMessage("older");
    const older = active().id;
    newConversation();
    addUserMessage("newer");
    deleteConversation(active().id);
    expect(active().id).toBe(older);
    deleteConversation(older);
    expect(all()).toHaveLength(1); // never zero: a fresh chat takes its place
    expect(active().messages).toEqual([]);
  });

  it("saves to storage and restores, closing a turn cut off mid-stream", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    undo = initConversations(storage);
    const f = createFolder("Work")!;
    addUserMessage("hi");
    send({ type: "status", state: "running" }, { type: "thinking", text: "hmm" });
    moveConversation(active().id, f);
    vi.advanceTimersByTime(1000); // past the debounced save
    const saved = JSON.parse(storage.getItem(KEY)!);
    expect(saved.folders[0].name).toBe("Work");
    undo();

    useStore.setState(initialState, true);
    undo = initConversations(storage);
    expect(active().folderId).toBe(f);
    const turn = useStore.getState().messages.at(-1)!;
    expect(turn.blocks[0]).toMatchObject({ kind: "thinking", done: true });
    expect(turn.error).toMatch(/interrupted/);
    vi.useRealTimers();
  });

  it("survives garbage in storage", () => {
    for (const bad of ["{not json", "null", "[1,2]", JSON.stringify({ conversations: { x: { id: 1 } }, folders: "no" })]) {
      undo();
      undo = initConversations(memoryStorage({ [KEY]: bad }));
      expect(all()).toHaveLength(1);
      expect(active().messages).toEqual([]);
    }
  });

  it("restored message ids never collide with new ones", () => {
    const storage = memoryStorage();
    undo = initConversations(storage);
    addUserMessage("hi");
    undo();
    undo = initConversations(storage);
    addUserMessage("again");
    const ids = useStore.getState().messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("several chats at once, and manual order", () => {
  /** Make chats "a", "b", "c"… and return their ids by title. */
  function makeChats(...titles: string[]) {
    undo = initConversations(memoryStorage());
    const ids: Record<string, string> = {};
    titles.forEach((t, i) => {
      if (i > 0) newConversation();
      addUserMessage(t);
      renameConversation(active().id, t);
      ids[t] = active().id;
    });
    return ids;
  }
  const list = (folderId: string | null = null) =>
    all().filter((c) => c.folderId === folderId).sort(byOrder).map((c) => c.title);

  it("puts new chats on top, and keeps the order when chats get new messages", () => {
    const id = makeChats("a", "b", "c");
    expect(list()).toEqual(["c", "b", "a"]);
    switchConversation(id.a!);
    addUserMessage("more"); // activity no longer reorders
    expect(list()).toEqual(["c", "b", "a"]);
  });

  it("places dragged chats before a chat, at the end, or on top", () => {
    const id = makeChats("a", "b", "c", "d"); // listed d c b a
    placeConversations([id.a!], null, id.c!);
    expect(list()).toEqual(["d", "a", "c", "b"]);
    placeConversations([id.d!], null, null);
    expect(list()).toEqual(["a", "c", "b", "d"]);
    placeConversations([id.b!, id.d!], null, FIRST); // several keep their relative order
    expect(list()).toEqual(["b", "d", "a", "c"]);
    placeConversations([id.b!, id.d!], null, id.d!); // "before one of the moved" = before the next that stays
    expect(list()).toEqual(["b", "d", "a", "c"]);
  });

  it("drops into a folder at an exact spot", () => {
    const id = makeChats("a", "b", "c");
    const f = createFolder("F")!;
    moveConversations([id.a!, id.b!], f); // listed b, a: they keep that order inside
    expect(list(f)).toEqual(["b", "a"]);
    placeConversations([id.c!], f, id.a!);
    expect(list(f)).toEqual(["b", "c", "a"]);
    expect(list()).toEqual([]);
  });

  it("deletes several chats, keeping the running one", () => {
    const id = makeChats("a", "b", "c"); // c is open
    useStore.setState({ running: true });
    expect(deleteConversations([id.a!, id.c!]).sort()).toEqual([id.a!]);
    useStore.setState({ running: false });
    expect(deleteConversations([id.b!, id.c!]).length).toBe(2);
    expect(all()).toHaveLength(1); // a fresh chat replaces the last one
  });

  it("gives chats saved before manual order the order they were shown in", () => {
    const old = (id: string, updatedAt: number) => ({ id, title: id, folderId: null, createdAt: 0, updatedAt, messages: [] });
    undo = initConversations(
      memoryStorage({ [KEY]: JSON.stringify({ conversations: { x: old("x", 1), y: old("y", 3), z: old("z", 2) }, folders: [], activeId: "x" }) }),
    );
    expect(list()).toEqual(["y", "z", "x"]); // most recent first, as before
  });
});

describe("metrics", () => {
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    undo = initConversations(memoryStorage());
  });

  const at = (ms: number, ...events: ServerEvent[]) => {
    clock = ms;
    send(...events);
  };

  it("measures tok/s while streaming, excluding tool time", () => {
    addUserMessage("go");
    beginTurn("bonsai-2:27b");
    at(0, { type: "status", state: "running" });
    at(500, { type: "thinking", text: "a" }); // first token after 0.5 s
    for (let i = 1; i <= 10; i++) at(500 + i * 100, { type: "thinking", text: "a" }); // 1 s of streaming
    at(1600, { type: "tool_call", id: "t", name: "list_files", args: {} });
    at(9600, { type: "tool_result", id: "t", name: "list_files", result: "", is_error: false }); // 8 s in a tool
    for (let i = 0; i <= 10; i++) at(10_000 + i * 100, { type: "text", text: "b" }); // another 1 s
    expect(useLiveStats.getState().live).not.toBeNull();
    at(11_200, { type: "done" }, { type: "status", state: "idle" });

    const stats = useStore.getState().messages.at(-1)!.stats!;
    expect(stats).toMatchObject({
      model: "bonsai-2:27b",
      outputTokens: 22,
      thinkingTokens: 11,
      estimated: true,
      ttftMs: 500,
      durationMs: 11_200,
      toolCalls: 1,
    });
    expect(stats.tokensPerSecond).toBeCloseTo(11, 5); // 22 tokens / 2 s, not / 11 s
    expect(useLiveStats.getState().live).toBeNull();
    expect(active().messages.at(-1)!.stats).toEqual(stats); // and it's saved with the chat
  });

  it("prefers usage from the server when it's sent", () => {
    addUserMessage("go");
    beginTurn();
    at(0, { type: "status", state: "running" });
    for (let i = 0; i <= 10; i++) at(i * 100, { type: "text", text: "chunk" });
    at(1000, { type: "done", usage: { input_tokens: 10, output_tokens: 50 } });
    const stats = useStore.getState().messages.at(-1)!.stats!;
    expect(stats).toMatchObject({ outputTokens: 50, estimated: false });
    expect(stats.tokensPerSecond).toBeCloseTo(50, 5);
  });

  it("gives no rate for a turn too short to measure, and still closes on error", () => {
    addUserMessage("go");
    beginTurn();
    at(0, { type: "status", state: "running" });
    at(10, { type: "text", text: "x" });
    at(20, { type: "error", message: "boom" });
    const m = useStore.getState().messages.at(-1)!;
    expect(m.error).toBe("boom");
    expect(m.stats?.tokensPerSecond).toBeUndefined();
    expect(m.stats?.outputTokens).toBe(1);
  });

  it("totals a conversation, weighting speed by tokens", () => {
    const base = { startedAt: 0, thinkingTokens: 0, durationMs: 1, toolCalls: 1, estimated: true };
    const t = totals([
      { id: "u", role: "user", blocks: [] },
      { id: "a", role: "assistant", blocks: [], stats: { ...base, outputTokens: 100, tokensPerSecond: 10 } }, // 10 s
      { id: "b", role: "assistant", blocks: [], stats: { ...base, outputTokens: 100, tokensPerSecond: 50 } }, // 2 s
    ]);
    expect(t).toMatchObject({ turns: 2, outputTokens: 200, toolCalls: 2, estimated: true });
    expect(t.tokensPerSecond).toBeCloseTo(200 / 12, 5);
  });
});

it("relativeTime reads like a chat list", () => {
  const now = 1_000_000_000_000;
  expect(relativeTime(now - 5_000, now)).toBe("now");
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
});
