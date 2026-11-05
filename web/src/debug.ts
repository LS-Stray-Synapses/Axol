// window.harnessDebug: inspection + self-test, dev builds only (main.tsx only
// imports this file when import.meta.env.DEV). Open the browser console and
// try harnessDebug.getState() or await harnessDebug.selfTest().
//
// selfTest() works on the live page: it injects fake server events through
// the same pipeline the socket uses, then checks both the state and the DOM.
// It saves and restores the chat, but run it while the agent is idle.

import { createElement, useEffect } from "react";
import type { ServerEvent } from "./contract";
import { dismissApproval, useApprovals } from "./approvals";
import { callOperation, receive } from "./backend";
import { _approvalDialogStatus } from "./components/ApprovalDialog";
import { getErrors, getEventLog } from "./diagnostics";
import { loadPlugin, unloadPlugin } from "./plugins";
import { listSlots, register } from "./slots";
import { flushServerEvents, resetChat, useStore } from "./store";
import { submitUserMessage } from "./wiring";
import type { Harness } from "../plugin-api";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function getState() {
  flushServerEvents(); // include events still waiting for the next frame
  const s = useStore.getState();
  // A deep copy: poking at the result must not be able to change the app.
  return structuredClone({
    connection: s.connection,
    running: s.running,
    messages: s.messages,
    pendingApprovals: useApprovals.getState().pending,
    plugins: s.plugins,
    usage: s.usage,
  });
}

function inject(event: ServerEvent | unknown): void {
  receive(event, true);
  flushServerEvents(); // so callers can inspect the result right away
}

// ---------------------------------------------------------------- self-test helpers

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until pred() is truthy (React renders asynchronously). */
async function waitFor<T>(pred: () => T, what: string, timeoutMs = 3000): Promise<NonNullable<T>> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const v = pred();
    if (v) return v as NonNullable<T>;
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const q = (sel: string, root: ParentNode = document) => root.querySelector(sel);
const lastAssistant = () => getState().messages.filter((m) => m.role === "assistant").at(-1);
const messageEl = (id: string) => q(`[data-message-id="${id}"]`);

/** Inject one complete fake turn. */
function turn(...events: ServerEvent[]) {
  inject({ type: "status", state: "running" });
  for (const e of events) inject(e);
  inject({ type: "done" });
  inject({ type: "status", state: "idle" });
}

const XSS = [
  `<script>window.__harnessXss = "script"</script>`,
  `<img src=x onerror="window.__harnessXss='img'">`,
  `[click me](javascript:window.__harnessXss='link')`,
  `<a href="javascript:window.__harnessXss='a'">raw anchor</a>`,
  `![pic](javascript:window.__harnessXss='mdimg')`,
  `<svg onload="window.__harnessXss='svg'"></svg>`,
].join("\n\n");

/** Anything in this subtree that could run script? Returns a description or null. */
function findActiveContent(root: Element): string | null {
  for (const el of root.querySelectorAll("*")) {
    if (el.tagName === "SCRIPT") return "a <script> element";
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith("on")) return `${el.tagName.toLowerCase()} has ${attr.name}`;
      if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        return `${el.tagName.toLowerCase()} ${attr.name}="${attr.value}"`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- the checks

const CHECKS: [string, () => Promise<string>][] = [
  [
    "streamed text deltas → one assistant message with rendered markdown",
    async () => {
      const parts = ["# Self", "-test\n\nSome **bold** text.\n\n- one\n- tw", "o\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"];
      turn(...parts.map((text): ServerEvent => ({ type: "text", text })));
      const msgs = useStore.getState().messages.filter((m) => m.role === "assistant");
      assert(msgs.length === 1, `expected 1 assistant message, got ${msgs.length}`);
      const blocks = msgs[0]!.blocks;
      const only = blocks[0];
      assert(blocks.length === 1 && only?.kind === "text", `expected one text block, got ${blocks.length}`);
      assert(only.text === parts.join(""), "deltas were not concatenated in order");
      const el = await waitFor(() => {
        const m = messageEl(msgs[0]!.id);
        return m &&
          m.querySelector("h1")?.textContent === "Self-test" &&
          m.querySelectorAll("li").length === 2 &&
          m.querySelector("table td") &&
          m.querySelector("strong")
          ? m
          : null;
      }, "rendered markdown (h1, 2×li, table, strong)");
      return `rendered ${el.querySelectorAll("*").length} elements from ${parts.length} deltas`;
    },
  ],
  [
    "tool_call + tool_result with the same id → one card",
    async () => {
      const id = "selftest-tool";
      inject({ type: "status", state: "running" });
      inject({ type: "tool_call", id, name: "selftest_tool", args: { path: "a.txt" } });
      await waitFor(() => q(`[data-tool-id="${id}"] .h-spinner`), "spinner on the running card");
      inject({ type: "tool_result", id, name: "selftest_tool", result: "file contents", is_error: false });
      inject({ type: "done" });
      inject({ type: "status", state: "idle" });
      const tools = lastAssistant()!.blocks.filter((b) => b.kind === "tool");
      assert(tools.length === 1, `expected 1 tool block in state, got ${tools.length}`);
      assert(tools[0]!.kind === "tool" && tools[0]!.done, "tool block not marked done");
      await waitFor(() => !q(`[data-tool-id="${id}"] .h-spinner`), "spinner to disappear");
      const cards = document.querySelectorAll(`[data-tool-id="${id}"]`);
      assert(cards.length === 1, `expected 1 card in DOM, got ${cards.length}`);
      return "one block, one card, spinner replaced by result";
    },
  ],
  [
    "XSS payloads render as inert text",
    async () => {
      const w = window as unknown as { __harnessXss?: string };
      delete w.__harnessXss;
      turn(
        { type: "text", text: XSS },
        { type: "tool_call", id: "selftest-xss", name: "selftest_tool", args: { html: XSS } },
        { type: "tool_result", id: "selftest-xss", name: "selftest_tool", result: XSS, is_error: true },
      );
      const msg = lastAssistant()!;
      const el = await waitFor(() => {
        const m = messageEl(msg.id);
        return m && m.textContent?.includes("raw anchor") && m.querySelector("[data-tool-result]") ? m : null;
      }, "XSS message to render");
      await sleep(300); // give any onerror/onload a chance to fire
      const bad = findActiveContent(el);
      assert(!bad, `active content in DOM: ${bad}`);
      assert(w.__harnessXss === undefined, `a payload executed: ${w.__harnessXss}`);
      return "no <script>, no on* attributes, no javascript: URLs, nothing executed";
    },
  ],
  [
    "malformed / unknown events are logged, nothing crashes",
    async () => {
      const before = getErrors().length;
      inject({ type: "no_such_event" });
      inject({ type: "text" }); // missing field
      inject({ type: "tool_result", id: 5 }); // wrong types
      inject("{not json");
      inject(null);
      inject([1, 2, 3]);
      const added = getErrors().length - before;
      assert(added >= 6, `expected ≥6 new errors, got ${added}`);
      assert(q("[data-chat]") && q("[data-composer]"), "the UI is gone");
      // And the app still processes good events afterwards:
      turn({ type: "text", text: "still alive" });
      const id = lastAssistant()!.id; // grab it now; live events could add messages later
      await waitFor(() => messageEl(id)?.textContent?.includes("still alive"), "a good event after bad ones");
      return `${added} errors recorded, UI still rendering`;
    },
  ],
  [
    "register() adds an entry and its undo removes it",
    async () => {
      const count = () => listSlots()["header.actions"]!.length;
      const before = count();
      const undo = register(
        "header.actions",
        { id: "selftest-action", render: () => createElement("span", { "data-selftest-action": "" }, "ST") },
        "selftest",
      );
      assert(count() === before + 1, "listSlots did not grow");
      await waitFor(() => q("[data-selftest-action]"), "the entry to render");
      undo();
      undo(); // idempotent
      assert(count() === before, "listSlots did not shrink back");
      await waitFor(() => !q("[data-selftest-action]"), "the entry to disappear");
      return "registered, rendered, removed";
    },
  ],
  [
    "a throwing slot entry shows an error box, the others still render",
    async () => {
      const undos = [
        register(
          "header.actions",
          {
            id: "selftest-boom",
            render: () => {
              throw new Error("selftest boom");
            },
          },
          "selftest",
        ),
        register("header.actions", { id: "selftest-fine", render: () => createElement("span", { "data-selftest-fine": "" }, "ok") }, "selftest"),
      ];
      try {
        await waitFor(
          () => [...document.querySelectorAll("[data-slot-error]")].some((e) => e.textContent?.includes("selftest boom")),
          "the error box",
        );
        await waitFor(() => q("[data-selftest-fine]"), "the sibling entry");
        assert(q("[data-chat]") && q("[data-sidebar]"), "rest of the UI is gone");
        return "error box shown, sibling + rest of UI fine";
      } finally {
        undos.forEach((u) => u());
      }
    },
  ],
  [
    "loading then unloading a plugin leaves listSlots() as before",
    async () => {
      const before = JSON.stringify(listSlots());
      let cleanedUp = false;
      await loadPlugin("selftest-plugin", "/plugins/selftest/ui.js", async () => ({
        activate(h: Harness) {
          h.slots.register("sidebar.tabs", { id: "st-tab", title: "ST", render: () => h.html`<p>st</p>` });
          h.slots.register("header.actions", { id: "st-act", render: () => h.html`<span>st</span>` });
          h.slots.register("tool.renderer", { tool: "selftest_tool", render: () => h.html`<span>st</span>` });
          return () => {
            cleanedUp = true;
          };
        },
      }));
      const during = listSlots();
      const owned = Object.values(during).flat().filter((r) => r.plugin === "selftest-plugin").length;
      assert(owned === 3, `expected 3 registrations while loaded, got ${owned}`);
      assert(useStore.getState().plugins["selftest-plugin"]?.status === "active", "plugin not marked active");
      unloadPlugin("selftest-plugin");
      assert(JSON.stringify(listSlots()) === before, "listSlots() differs after unload");
      assert(cleanedUp, "the plugin's cleanup function did not run");
      assert(!useStore.getState().plugins["selftest-plugin"], "plugin still listed in state");
      return "3 registrations added and fully removed, cleanup ran";
    },
  ],
  [
    "the approval dialog can't be removed or answered from a slot entry",
    async () => {
      const id = "selftest-approval";
      inject({ type: "approval_request", id, tool: "write_file", args: { filename: "x.txt" }, reason: "self-test" });
      await waitFor(() => _approvalDialogStatus().open && _approvalDialogStatus().requestId === id, "the dialog to open");

      let attempted = false;
      // Everything a misbehaving plugin could try from inside its slot entry.
      function Hostile() {
        useEffect(() => {
          document.querySelectorAll("dialog").forEach((d) => d.remove()); // finds nothing: closed shadow root
          for (const el of [...document.body.children]) if (el.id !== "root") el.remove(); // removes the host
          for (const target of [window, document, document.activeElement ?? document.body]) {
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); // untrusted
          }
          attempted = true;
        }, []);
        return null;
      }
      const undo = register("header.actions", { id: "selftest-hostile", render: Hostile }, "selftest");
      try {
        await waitFor(() => attempted, "the hostile entry to run");
        await sleep(50);
        const st = _approvalDialogStatus();
        assert(st.hostConnected, "dialog host was removed from the page");
        assert(st.open && st.requestId === id, "dialog is no longer open");
        assert(st.modal, "dialog is open but no longer modal");
        assert(useApprovals.getState().pending.some((p) => p.id === id), "the approval was answered or dropped");
        return "host restored, still open + modal, fake Enter ignored";
      } finally {
        undo();
        dismissApproval(id);
      }
    },
  ],
];

async function selfTest(): Promise<CheckResult[]> {
  if (useStore.getState().running) console.warn("selfTest: the agent is running; results may be noisy");
  const saved = useStore.getState();
  const savedApprovals = useApprovals.getState().pending;
  resetChat();
  useApprovals.setState({ pending: [] });

  const results: CheckResult[] = [];
  try {
    for (const [name, fn] of CHECKS) {
      try {
        results.push({ name, pass: true, detail: await fn() });
      } catch (err) {
        results.push({ name, pass: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    // Put the user's chat back exactly as it was.
    useStore.setState({
      messages: saved.messages,
      openTurnId: saved.openTurnId,
      running: saved.running,
      usage: saved.usage,
      cancelRequested: saved.cancelRequested,
    });
    useApprovals.setState({ pending: savedApprovals });
  }
  console.table(results);
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed ? `selfTest: ${failed} of ${results.length} FAILED` : `selfTest: all ${results.length} passed`);
  return results;
}

export interface HarnessDebug {
  getState: typeof getState;
  getEventLog: typeof getEventLog;
  listSlots: typeof listSlots;
  getErrors: typeof getErrors;
  inject: typeof inject;
  runScenario: (name: string) => boolean;
  selfTest: typeof selfTest;
  /** not in the spec list, but handy from the console: harnessDebug.callOperation("tools.list") */
  callOperation: typeof callOperation;
}

export const harnessDebug: HarnessDebug = {
  getState,
  getEventLog,
  listSlots,
  getErrors,
  inject,
  runScenario: (name) => submitUserMessage(`/scenario ${name}`),
  selfTest,
  callOperation,
};

declare global {
  interface Window {
    harnessDebug?: HarnessDebug;
  }
}

export function installDebug(): void {
  window.harnessDebug = harnessDebug;
  console.info("harnessDebug ready: try harnessDebug.getState() or await harnessDebug.selfTest()");
}
