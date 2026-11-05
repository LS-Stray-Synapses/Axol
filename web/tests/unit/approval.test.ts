import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replies = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../src/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/backend")>()),
  replyApproval: (...args: unknown[]) => (replies.push(args), true),
}));

import { addApproval, clearApprovals, useApprovals } from "../../src/approvals";
import { _approvalDialogStatus, mountApprovalDialog } from "../../src/components/ApprovalDialog";

let unmount: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  act(() => {
    unmount = mountApprovalDialog();
    addApproval({ type: "approval_request", id: "a1", tool: "write_file", args: { filename: "x" }, reason: "test" });
  });
  act(() => vi.advanceTimersByTime(1000)); // past the arming delay
});

afterEach(() => {
  act(() => {
    clearApprovals();
    unmount();
    vi.runAllTimers();
  });
  vi.useRealTimers();
  replies.length = 0;
});

const pending = () => useApprovals.getState().pending.map((p) => p.id);

describe("approval dialog", () => {
  it("opens for a pending request", () => {
    expect(_approvalDialogStatus()).toMatchObject({ open: true, requestId: "a1", hostConnected: true });
  });

  it("is invisible to document queries (closed shadow root)", () => {
    expect(document.querySelector("dialog")).toBeNull();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Allow"))).toBe(false);
  });

  it("ignores synthetic (untrusted) Enter and Escape", () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(pending()).toEqual(["a1"]);
    expect(replies).toEqual([]);
  });

  it("comes back if its host element is removed", async () => {
    for (const el of [...document.body.children]) el.remove();
    await act(async () => {
      await Promise.resolve(); // MutationObserver callbacks are microtasks
    });
    expect(_approvalDialogStatus().hostConnected).toBe(true);
    expect(pending()).toEqual(["a1"]);
  });
});
