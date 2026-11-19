// The strip above the chat: which conversation this is, where it's filed,
// and its running totals. Click the title to rename it.

import { useState } from "react";
import { newConversation, renameConversation, useConversations } from "../conversations";
import { useStore } from "../store";
import { ConversationTotals } from "./TurnStats";

export function ConversationBar() {
  const c = useConversations((s) => s.conversations[s.activeId]);
  const folder = useConversations((s) => s.folders.find((f) => f.id === c?.folderId));
  const busy = useStore((s) => s.running);
  const [editing, setEditing] = useState<string | null>(null);
  if (!c) return null;

  const commit = () => {
    if (editing !== null) renameConversation(c.id, editing);
    setEditing(null);
  };

  return (
    <div data-conversation-bar className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
      {folder && (
        <>
          <span className="max-w-40 shrink-0 truncate text-muted" title={`folder: ${folder.name}`}>📁 {folder.name}</span>
          <span className="text-muted">/</span>
        </>
      )}
      {editing !== null ? (
        <input
          autoFocus
          aria-label="chat title"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(null);
          }}
          onBlur={commit}
          className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 outline-none"
        />
      ) : (
        <button
          type="button"
          data-conversation-title
          title="rename"
          onClick={() => setEditing(c.title)}
          className="min-w-0 truncate text-left font-medium hover:text-accent"
        >
          {c.title}
        </button>
      )}
      <div className="flex-1" />
      <ConversationTotals />
      <button
        type="button"
        disabled={busy}
        title={busy ? "Wait for the current turn to finish" : "new chat"}
        onClick={() => newConversation(c.folderId)}
        className="shrink-0 rounded px-1.5 text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
      >
        ＋
      </button>
    </div>
  );
}
