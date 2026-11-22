// The Chats tab: conversations grouped into folders. Registered through the
// sidebar.tabs slot like every other built-in.
//
// Selecting several chats works like a file manager:
//   Ctrl/⌘+click toggles one, Shift+click selects a range, the ☑ button (or
//   a folder's checkbox) selects with plain clicks. Then the bar on top moves
//   or deletes them all; dragging a selected chat drags the whole selection.
//   Esc clears the selection.

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Popover } from "../components/Popover";
import {
  FIRST,
  byOrder,
  createFolder,
  deleteConversation,
  deleteConversations,
  deleteFolder,
  moveConversations,
  newConversation,
  placeConversations,
  relativeTime,
  renameConversation,
  renameFolder,
  searchText,
  switchConversation,
  toggleFolder,
  useConversations,
  type Conversation,
  type Folder,
} from "../conversations";
import { useStore } from "../store";

const DRAG_TYPE = "application/x-axol-chats"; // payload: JSON array of chat ids
const BUSY = "Wait for the current turn to finish";
/** drop-target key for "not in a folder" */
const NO_FOLDER = "";

type Selection = ReadonlySet<string>;

/** Where a dragged chat would land if dropped now: shown while dragging. */
type DropTarget =
  | { kind: "row"; id: string; pos: "above" | "below" } // a line above/below that chat
  | { kind: "group"; key: string } // the whole folder lights up: goes on top of it
  | null;

const carriesChats = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

/** The chat ids a drop carries, or null if it isn't ours. */
function droppedIds(e: DragEvent): string[] | null {
  try {
    const ids: unknown = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** A text input that commits on Enter or blur and cancels on Esc. */
function InlineEdit({ initial, label, onDone }: { initial: string; label: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (finished.current) return; // Enter then blur would commit twice
    finished.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") {
          e.preventDefault(); // Esc here cancels the edit, not the selection
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 text-sm outline-none"
    />
  );
}

function IconButton({ title, onClick, children, danger }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded px-1 text-xs text-muted hover:bg-raised ${danger ? "hover:text-danger" : "hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

/** "Really delete?" inline, instead of a browser confirm() popup. */
function ConfirmDelete({ what, label = "delete?", onYes, onNo }: { what: string; label?: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex items-center gap-1 text-xs" role="group" aria-label={`confirm delete ${what}`}>
      <span className="text-danger">{label}</span>
      <button type="button" onClick={onYes} className="rounded px-1 text-danger hover:bg-danger/10">yes</button>
      <button type="button" onClick={onNo} autoFocus className="rounded px-1 text-muted hover:bg-raised hover:text-fg">no</button>
    </div>
  );
}

/** A checkbox that can also show "some" (a folder with part of its chats selected). */
function Check({ state, label, onChange }: { state: "none" | "some" | "all"; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === "all"}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="size-3.5 shrink-0 accent-[var(--h-accent)]"
    />
  );
}

/** The folders a chat (or a selection) can move to. */
function MoveMenu({ folders, current, onMove, onNewFolder }: {
  folders: Folder[];
  current?: string | null;
  onMove: (folderId: string | null) => void;
  onNewFolder?: () => void;
}) {
  return (
    <>
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-muted">Move to</div>
      {[{ id: NO_FOLDER, name: "No folder" }, ...folders].map((f) => {
        const here = current !== undefined && (current ?? NO_FOLDER) === f.id;
        return (
          <button
            key={f.id || "none"}
            type="button"
            role="menuitem"
            disabled={here}
            onClick={() => onMove(f.id || null)}
            className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-raised disabled:text-muted disabled:hover:bg-transparent"
          >
            {f.id ? "📁 " : ""}
            {f.name}
            {here ? " ✓" : ""}
          </button>
        );
      })}
      {onNewFolder && (
        <button type="button" role="menuitem" onClick={onNewFolder} className="w-full rounded px-2 py-1 text-left text-sm text-accent hover:bg-raised">
          ＋ New folder…
        </button>
      )}
    </>
  );
}

function ConversationRow({ c, nextId, isActive, busy, folders, selecting, selected, onPick, dragIds, drop, setDrop }: {
  c: Conversation;
  /** the chat listed after this one in its folder (null = last): "drop below me" means "before it" */
  nextId: string | null;
  isActive: boolean;
  busy: boolean;
  folders: Folder[];
  /** selection mode: plain clicks select instead of opening */
  selecting: boolean;
  selected: boolean;
  onPick: (e: MouseEvent, id: string) => void;
  /** what a drag starting on this row carries */
  dragIds: () => string[];
  drop: DropTarget;
  setDrop: (d: DropTarget) => void;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "confirm">("idle");
  const locked = busy && !isActive && !selecting; // the running chat stays usable, others wait
  const turns = c.messages.filter((m) => m.role === "user").length;

  if (mode === "rename") {
    return (
      <div className="flex items-center px-1 py-0.5">
        <InlineEdit
          initial={c.title}
          label="chat title"
          onDone={(v) => {
            if (v !== null) renameConversation(c.id, v);
            setMode("idle");
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-conversation={c.id}
      data-active={isActive || undefined}
      data-selected={selected || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds()));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDrop(null)}
      onDragOver={(e) => {
        if (!carriesChats(e)) return;
        e.preventDefault();
        e.stopPropagation(); // the row decides, not its folder
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < r.top + r.height / 2 ? "above" : "below";
        if (drop?.kind !== "row" || drop.id !== c.id || drop.pos !== pos) setDrop({ kind: "row", id: c.id, pos });
      }}
      onDrop={(e) => {
        const ids = droppedIds(e);
        const pos = drop?.kind === "row" && drop.id === c.id ? drop.pos : "above";
        setDrop(null);
        if (!ids) return;
        e.preventDefault();
        e.stopPropagation();
        placeConversations(ids, c.folderId, pos === "above" ? c.id : nextId);
      }}
      className={`group relative flex items-center gap-1.5 rounded px-1 ${
        selected ? "bg-accent/15" : isActive ? "bg-raised" : "hover:bg-raised/60"
      }`}
    >
      {drop?.kind === "row" && drop.id === c.id && (
        // The drop line: exactly where the chat goes if you let go now.
        <div
          data-drop-line={drop.pos}
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 z-10 flex items-center ${drop.pos === "above" ? "-top-[3px]" : "-bottom-[3px]"}`}
        >
          <span className="size-1.5 rounded-full bg-accent" />
          <span className="h-0.5 flex-1 rounded bg-accent" />
        </div>
      )}
      {selecting && <Check state={selected ? "all" : "none"} label={`select ${c.title}`} onChange={() => onPick({ ctrlKey: true } as MouseEvent, c.id)} />}
      <button
        type="button"
        aria-disabled={locked || undefined}
        title={locked ? BUSY : selecting ? "click to select · Shift+click for a range" : `${c.title} · Ctrl/⌘+click to select`}
        aria-current={isActive || undefined}
        aria-pressed={selecting ? selected : undefined}
        onClick={(e) => (locked && !e.ctrlKey && !e.metaKey && !e.shiftKey ? undefined : onPick(e, c.id))}
        onDoubleClick={() => !selecting && setMode("rename")}
        className={`flex min-w-0 flex-1 select-none items-baseline gap-2 py-1 text-left aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${
          isActive || selected ? "text-fg" : "text-muted hover:text-fg"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        <span
          className={`shrink-0 text-[10px] text-muted ${selecting ? "" : "group-hover:hidden"}`}
          title={`${turns} messages · ${new Date(c.updatedAt).toLocaleString()}`}
        >
          {relativeTime(c.updatedAt)}
        </span>
      </button>
      {selecting ? null : mode === "confirm" ? (
        <ConfirmDelete
          what={c.title}
          onYes={() => {
            deleteConversation(c.id);
            setMode("idle");
          }}
          onNo={() => setMode("idle")}
        />
      ) : (
        <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <IconButton title="rename" onClick={() => setMode("rename")}>✎</IconButton>
          <Popover label={<span className="text-xs">⇄</span>} title="move to folder">
            {(close) => (
              <MoveMenu
                folders={folders}
                current={c.folderId}
                onMove={(f) => {
                  moveConversations([c.id], f);
                  close();
                }}
              />
            )}
          </Popover>
          <IconButton title="delete chat" danger onClick={() => (isActive && busy ? undefined : setMode("confirm"))}>✕</IconButton>
        </div>
      )}
    </div>
  );
}

/** A folder (or the "no folder" group): a header that's also a drop target, then its chats. */
function Group({ folder, title, count, collapsed, busy, dropKey, drop, setDrop, selectState, onSelectAll, children }: {
  folder?: Folder;
  title: string;
  count: number;
  collapsed: boolean;
  busy: boolean;
  dropKey: string;
  drop: DropTarget;
  setDrop: (d: DropTarget) => void;
  /** shown while selecting: whether this group's chats are selected */
  selectState?: "none" | "some" | "all";
  onSelectAll?: () => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "confirm">("idle");
  const lit = drop?.kind === "group" && drop.key === dropKey;

  // Over the header, an empty folder or the gaps: the chat goes on top of this folder.
  // (Over a chat row, the row handles it and shows a line instead.)
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!carriesChats(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!lit) setDrop({ kind: "group", key: dropKey });
    },
    onDragLeave: (e: DragEvent) => {
      if (lit && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
    },
    onDrop: (e: DragEvent) => {
      const ids = droppedIds(e);
      setDrop(null);
      if (!ids) return;
      e.preventDefault();
      placeConversations(ids, folder?.id ?? null, FIRST);
    },
  };

  return (
    <section
      data-folder={folder?.id ?? "none"}
      {...dropProps}
      className={`rounded-md ${lit ? "bg-accent/10 outline outline-1 outline-accent/60" : ""}`}
    >
      <div className="group flex items-center gap-1 px-1 pt-1">
        {selectState && onSelectAll && count > 0 && (
          <Check state={selectState} label={`select all in ${title}`} onChange={onSelectAll} />
        )}
        {mode === "rename" && folder ? (
          <InlineEdit
            initial={folder.name}
            label="folder name"
            onDone={(v) => {
              if (v !== null) renameFolder(folder.id, v);
              setMode("idle");
            }}
          />
        ) : (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => folder && toggleFolder(folder.id)}
            onDoubleClick={() => folder && setMode("rename")}
            className={`flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-xs font-medium uppercase tracking-wide text-muted ${
              folder ? "hover:text-fg" : "cursor-default"
            }`}
          >
            {folder && <span className="w-3 shrink-0 text-center">{collapsed ? "▸" : "▾"}</span>}
            <span className="truncate">{folder ? `📁 ${title}` : title}</span>
            <span className="shrink-0 font-normal normal-case text-muted/70">{count}</span>
          </button>
        )}
        {folder && mode === "confirm" && (
          <ConfirmDelete
            what={folder.name}
            onYes={() => {
              deleteFolder(folder.id);
              setMode("idle");
            }}
            onNo={() => setMode("idle")}
          />
        )}
        {folder && mode === "idle" && (
          <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
            <IconButton title={busy ? BUSY : "new chat in this folder"} onClick={() => newConversation(folder.id)}>＋</IconButton>
            <IconButton title="rename folder" onClick={() => setMode("rename")}>✎</IconButton>
            <IconButton title="delete folder (its chats are kept)" danger onClick={() => setMode("confirm")}>✕</IconButton>
          </div>
        )}
      </div>
      {/* Chats inside a folder sit indented under it, with a guide line, like a file tree. */}
      {!collapsed && (
        <div data-folder-children className={`flex flex-col pb-1 ${folder ? "ml-2.5 border-l border-border pl-1.5" : ""}`}>
          {children}
        </div>
      )}
    </section>
  );
}

/** The bar shown while chats are selected: act on all of them at once. */
function SelectionBar({ selected, visible, folders, busy, activeId, onSelectAll, onClear, onDone }: {
  selected: Selection;
  visible: string[];
  folders: Folder[];
  busy: boolean;
  activeId: string;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "confirm" | "newFolder">("idle");
  const n = selected.size;
  const allVisible = visible.length > 0 && visible.every((id) => selected.has(id));
  const skipsActive = busy && selected.has(activeId);

  return (
    <div data-selection-bar className="flex flex-col gap-1.5 rounded-md border border-accent/50 bg-accent/10 p-1.5">
      <div className="flex items-center gap-1.5">
        <Check state={allVisible ? "all" : n > 0 ? "some" : "none"} label="select all chats" onChange={allVisible ? onClear : onSelectAll} />
        <span data-selected-count className="flex-1 text-xs">
          {n === 0 ? "Select chats" : `${n} selected`}
        </span>
        <button type="button" onClick={onDone} className="rounded px-1.5 text-xs text-muted hover:bg-raised hover:text-fg">
          Done
        </button>
      </div>
      {n > 0 && mode === "idle" && (
        <div className="flex items-center gap-1">
          <Popover label={<span className="text-xs">Move to ▾</span>} title="move selected chats" align="left">
            {(close) => (
              <MoveMenu
                folders={folders}
                onMove={(f) => {
                  moveConversations(selected, f);
                  close();
                }}
                onNewFolder={() => {
                  close();
                  setMode("newFolder");
                }}
              />
            )}
          </Popover>
          <div className="flex-1" />
          <button
            type="button"
            data-delete-selected
            onClick={() => setMode("confirm")}
            className="rounded px-1.5 py-0.5 text-xs text-danger hover:bg-danger/10"
          >
            Delete
          </button>
        </div>
      )}
      {mode === "newFolder" && (
        <div className="flex">
          <InlineEdit
            initial=""
            label="new folder for selected chats"
            onDone={(v) => {
              const id = v ? createFolder(v) : null;
              if (id) moveConversations(selected, id);
              setMode("idle");
            }}
          />
        </div>
      )}
      {mode === "confirm" && (
        <ConfirmDelete
          what={`${n} chats`}
          label={skipsActive ? `delete ${n - 1}? (the running chat is kept)` : `delete ${n} chat${n === 1 ? "" : "s"}?`}
          onYes={() => {
            deleteConversations(selected);
            setMode("idle");
          }}
          onNo={() => setMode("idle")}
        />
      )}
    </div>
  );
}

export function ChatsTab() {
  const conversations = useConversations((s) => s.conversations);
  const folders = useConversations((s) => s.folders);
  const activeId = useConversations((s) => s.activeId);
  const busy = useStore((s) => s.running);
  const [query, setQuery] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [drop, setDrop] = useState<DropTarget>(null);
  const [selected, setSelected] = useState<Selection>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const anchor = useRef<string | null>(null); // where a Shift+click range starts
  const selecting = selectMode || selected.size > 0;

  const q = query.trim().toLowerCase();
  const byGroup = useMemo(() => {
    const groups = new Map<string, Conversation[]>();
    const sorted = Object.values(conversations).sort(byOrder);
    for (const c of sorted) {
      if (q && !searchText(c).includes(q)) continue;
      const key = c.folderId ?? NO_FOLDER;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return groups;
  }, [conversations, q]);

  const isOpen = (f: Folder) => !f.collapsed || !!q;
  const unfiled = byGroup.get(NO_FOLDER) ?? [];
  // Chats in on-screen order: what Shift+click ranges and "select all" use.
  const visible = useMemo(
    () => [...folders.filter(isOpen).flatMap((f) => byGroup.get(f.id) ?? []), ...unfiled].map((c) => c.id),
    [folders, byGroup, q],
  );

  // Deleted chats (here or in another component) drop out of the selection.
  useEffect(() => {
    if ([...selected].some((id) => !conversations[id])) {
      setSelected(new Set([...selected].filter((id) => conversations[id])));
    }
  }, [conversations, selected]);

  // Esc anywhere clears the selection (focus is often elsewhere, e.g. after a
  // menu closed). Something that already handled Esc, like an edit box, wins.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setSelected(new Set());
        setSelectMode(false);
        anchor.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const clear = () => {
    setSelected(new Set());
    anchor.current = null;
  };
  const done = () => {
    clear();
    setSelectMode(false);
  };

  function pick(e: MouseEvent, id: string) {
    if (e.shiftKey && anchor.current && visible.includes(anchor.current)) {
      const i = visible.indexOf(anchor.current), j = visible.indexOf(id);
      setSelected(new Set([...selected, ...visible.slice(Math.min(i, j), Math.max(i, j) + 1)]));
      return;
    }
    if (e.ctrlKey || e.metaKey || selecting) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      anchor.current = id;
      return;
    }
    anchor.current = id;
    switchConversation(id);
  }

  function toggleGroup(ids: string[]) {
    const all = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  }
  const groupState = (ids: string[]) => {
    const n = ids.filter((id) => selected.has(id)).length;
    return n === 0 ? "none" : n === ids.length ? "all" : "some";
  };

  const rows = (list: Conversation[] = []) =>
    list.map((c, i) => (
      <ConversationRow
        key={c.id}
        c={c}
        nextId={list[i + 1]?.id ?? null}
        drop={drop}
        setDrop={setDrop}
        isActive={c.id === activeId}
        busy={busy}
        folders={folders}
        selecting={selecting}
        selected={selected.has(c.id)}
        onPick={pick}
        dragIds={() => (selected.has(c.id) ? [...selected] : [c.id])}
      />
    ));

  const matches = [...byGroup.values()].reduce((n, l) => n + l.length, 0);

  return (
    <div data-chats-tab className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          data-new-chat
          disabled={busy}
          title={busy ? BUSY : "start a new chat"}
          onClick={() => newConversation()}
          className="flex-1 rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
        >
          ＋ New chat
        </button>
        <button
          type="button"
          data-new-folder
          title="new folder"
          onClick={() => setAddingFolder(true)}
          className="rounded-md border border-border px-2 text-sm text-muted hover:text-fg"
        >
          📁＋
        </button>
        <button
          type="button"
          data-select-mode
          title="select several chats (or Ctrl/⌘+click them)"
          aria-pressed={selecting}
          onClick={() => (selecting ? done() : setSelectMode(true))}
          className={`rounded-md border px-2 text-sm ${selecting ? "border-accent bg-accent/15 text-fg" : "border-border text-muted hover:text-fg"}`}
        >
          ☑
        </button>
      </div>

      {addingFolder && (
        <div className="flex">
          <InlineEdit
            initial=""
            label="new folder name"
            onDone={(v) => {
              if (v) createFolder(v);
              setAddingFolder(false);
            }}
          />
        </div>
      )}

      {selecting && (
        <SelectionBar
          selected={selected}
          visible={visible}
          folders={folders}
          busy={busy}
          activeId={activeId}
          onSelectAll={() => setSelected(new Set([...selected, ...visible]))}
          onClear={clear}
          onDone={done}
        />
      )}

      <input
        type="search"
        aria-label="search chats"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
      />

      <div className="flex flex-col gap-1">
        {folders.map((f) => {
          const list = byGroup.get(f.id) ?? [];
          if (q && list.length === 0) return null;
          const ids = list.map((c) => c.id);
          return (
            <Group
              key={f.id}
              folder={f}
              title={f.name}
              count={list.length}
              collapsed={!isOpen(f)}
              busy={busy}
              dropKey={f.id}
              drop={drop}
              setDrop={setDrop}
              selectState={selecting ? groupState(ids) : undefined}
              onSelectAll={() => toggleGroup(ids)}
            >
              {list.length ? rows(list) : <p className="px-2 py-1 text-xs text-muted">Empty. Drag a chat here.</p>}
            </Group>
          );
        })}
        {(unfiled.length > 0 || !q) && (
          <Group
            title={folders.length ? "Other chats" : "Chats"}
            count={unfiled.length}
            collapsed={false}
            busy={busy}
            dropKey={NO_FOLDER}
            drop={drop}
            setDrop={setDrop}
            selectState={selecting ? groupState(unfiled.map((c) => c.id)) : undefined}
            onSelectAll={() => toggleGroup(unfiled.map((c) => c.id))}
          >
            {rows(unfiled)}
          </Group>
        )}
        {q && matches === 0 && <p className="px-1 text-xs text-muted">No chats match “{query.trim()}”.</p>}
      </div>

      <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted">
        Each chat has its own model memory, kept by the server. Titles, folders and stats are saved in this
        browser. Long-term memory (Memory tab) is shared by all chats.
      </p>
    </div>
  );
}
