// Pending tool approvals, deliberately kept in their own store that is NOT
// exposed to plugins. The approval dialog is the one place where the human
// says yes or no to the agent touching the world, so no plugin code should be
// able to read it, fake it or answer it. See ApprovalDialog.tsx for the rest
// of that defence.

import { create } from "zustand";
import type { EventOf } from "./contract";
import { replyApproval } from "./backend";

export type ApprovalRequest = Omit<EventOf<"approval_request">, "type">;

export const useApprovals = create<{ pending: ApprovalRequest[] }>()(() => ({ pending: [] }));

export function addApproval(e: EventOf<"approval_request">): void {
  const { type: _type, ...req } = e;
  useApprovals.setState((s) =>
    s.pending.some((p) => p.id === req.id) ? s : { pending: [...s.pending, req] },
  );
}

/** Send the user's answer and drop the request. Only ApprovalDialog calls this. */
export function answerApproval(id: string, approved: boolean): void {
  if (!useApprovals.getState().pending.some((p) => p.id === id)) return; // already answered
  replyApproval(id, approved);
  dismissApproval(id);
}

/** Remove without answering: the turn ended (idle/disconnect) or a self-test cleans up. */
export function dismissApproval(id: string): void {
  useApprovals.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
}

export function clearApprovals(): void {
  useApprovals.setState({ pending: [] });
}
