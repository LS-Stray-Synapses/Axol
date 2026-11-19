// Conversations and folders, kept in the browser (localStorage).
//
// The chat store (store.ts) stays exactly what it was: the live view of ONE
// chat, folded from server events. This module owns the list of chats around
// it. A subscription copies the chat store's messages into the active
// conversation as they change; switching conversations loads another one's
// messages back into the chat store. The reducer never knows conversations
// exist, which keeps it pure and its tests unchanged.
//
// Two halves of a conversation, each kept where it belongs:
// - here (browser): what you SEE: title, folder, rendered blocks, stats;
// - the server (sessions/<id>.jsonl): what the MODEL saw, an append-only log.
// They share the conversation id: every user_message carries it (wiring.ts),
// and deleting a chat here deletes its server log too.

import { create } from "zustand";
import type { Block, ChatMessage } from "../plugin-api";
import { callOperation } from "./backend";
import { loadMessages, useStore } from "./store";

export const UNTITLED = "New chat";
const STORAGE_KEY = "axol.conversations.v1";
const SAVE_DELAY_MS = 400;
const TITLE_MAX = 60;

export interface Conversation {
  id: string;
  title: string;
  /** null = not in a folder */
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  /** position in the list: lower comes first. Set by dragging, not by activity. */
  order: number;
  messages: ChatMessage[];
}

export interface Folder {
  id: string;
  name: string;
  collapsed: boolean;
  createdAt: number;
}

export interface ConversationsState {
  conversations: Record<string, Conversation>;
  folders: Folder[];
  activeId: string;
}

export const useConversations = create<ConversationsState>()(() => ({
  conversations: {},
  folders: [],
  activeId: "",
}));

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** An order value that sorts before every existing chat: new chats go on top. */
const topOrder = (all: Record<string, Conversation>) => Math.min(0, ...Object.values(all).map((c) => c.order)) - 1;

function blank(folderId: string | null = null, order = 0): Conversation {
  const t = Date.now();
  return { id: uid("c"), title: UNTITLED, folderId, createdAt: t, updatedAt: t, order, messages: [] };
}

/** List order: manual `order`, newest first among equals. */
export const byOrder = (a: Conversation, b: Conversation) => a.order - b.order || b.updatedAt - a.updatedAt;

const get = () => useConversations.getState();
const set = useConversations.setState;
const active = (): Conversation | undefined => get().conversations[get().activeId];

/** Running turns stream into the chat store, so the visible chat must not change under them. */
export const canSwitch = () => !useStore.getState().running;

// ---------------------------------------------------------------- persistence

/** A turn that was streaming when the page closed can't be resumed: close it. */
function settle(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.blocks.some((b) => (b.kind === "thinking" || b.kind === "tool") && !b.done)
      ? {
          ...m,
          blocks: m.blocks.map((b): Block => (b.kind === "thinking" || b.kind === "tool" ? { ...b, done: true } : b)),
          error: m.error ?? "interrupted (the page was closed mid-turn)",
        }
      : m,
  );
}

function isConversation(v: unknown): v is Conversation {
  const c = v as Conversation;
  return (
    typeof c === "object" && c !== null &&
    typeof c.id === "string" && typeof c.title === "string" &&
    (c.folderId === null || typeof c.folderId === "string") &&
    typeof c.createdAt === "number" && typeof c.updatedAt === "number" &&
    Array.isArray(c.messages)
  );
}

function isFolder(v: unknown): v is Folder {
  const f = v as Folder;
  return typeof f === "object" && f !== null && typeof f.id === "string" && typeof f.name === "string";
}

/** Read saved state. Anything unreadable is dropped, never thrown. */
function load(storage: Storage): ConversationsState | null {
  let raw: unknown;
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Record<keyof ConversationsState, unknown>>;

  const folders = (Array.isArray(r.folders) ? r.folders : [])
    .filter(isFolder)
    .map((f) => ({ id: f.id, name: f.name, collapsed: !!f.collapsed, createdAt: Number(f.createdAt) || 0 }));
  const folderIds = new Set(folders.map((f) => f.id));

  const conversations: Record<string, Conversation> = {};
  for (const c of Object.values(typeof r.conversations === "object" && r.conversations ? r.conversations : {})) {
    if (!isConversation(c)) continue;
    conversations[c.id] = {
      ...c,
      folderId: c.folderId && folderIds.has(c.folderId) ? c.folderId : null,
      order: typeof c.order === "number" && Number.isFinite(c.order) ? c.order : NaN,
      messages: settle(c.messages),
    };
  }
  // Chats saved before manual ordering existed: keep the order they were
  // shown in (most recent first), after any chat that already has one.
  const unordered = Object.values(conversations).filter((c) => Number.isNaN(c.order)).sort((a, b) => b.updatedAt - a.updatedAt);
  const after = Math.max(-1, ...Object.values(conversations).filter((c) => !Number.isNaN(c.order)).map((c) => c.order));
  unordered.forEach((c, i) => (c.order = after + 1 + i));
  const activeId = typeof r.activeId === "string" ? r.activeId : "";
  return { conversations, folders, activeId };
}

let storage: Storage | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!storage) return;
  const { conversations, folders, activeId } = get();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ conversations, folders, activeId }));
  } catch (err) {
    // Most likely the ~5 MB quota. Keep working in memory rather than crash.
    console.warn("conversations: could not save", err);
  }
}

function scheduleSave() {
  if (!storage || saveTimer !== undefined) return;
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

// ---------------------------------------------------------------- setup

/**
 * Restore saved conversations, show the active one, and start syncing.
 * Returns an undo (tests). Pass `null` storage to keep everything in memory.
 */
export function initConversations(store: Storage | null = safeLocalStorage()): () => void {
  storage = store;
  const saved = storage ? load(storage) : null;
  let state: ConversationsState = saved ?? { conversations: {}, folders: [], activeId: "" };
  if (!state.conversations[state.activeId]) {
    // Reopen the most recent chat, or start a fresh one.
    const recent = Object.values(state.conversations).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const c = recent ?? blank();
    state = { ...state, conversations: { ...state.conversations, [c.id]: c }, activeId: c.id };
  }
  set(state, true);
  loadMessages(state.conversations[state.activeId]!.messages);

  // Chat store → active conversation. Only the messages array matters, and
  // it's replaced (never mutated) on every change, so a reference check is enough.
  const offChat = useStore.subscribe((s, prev) => {
    if (s.messages === prev.messages) return;
    const c = active();
    if (!c || c.messages === s.messages) return;
    set({
      conversations: { ...get().conversations, [c.id]: { ...c, messages: s.messages, updatedAt: Date.now() } },
    });
  });
  const offSave = useConversations.subscribe(scheduleSave);
  const onHide = () => saveNow();
  window.addEventListener("pagehide", onHide);

  return () => {
    offChat();
    offSave();
    window.removeEventListener("pagehide", onHide);
    saveNow();
    storage = null;
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // e.g. blocked by privacy settings
  }
}

// ---------------------------------------------------------------- conversations

function show(id: string) {
  set({ activeId: id });
  loadMessages(get().conversations[id]!.messages);
}

/** Open a fresh chat. Reuses the current one if it's still empty. Returns false while a turn runs. */
export function newConversation(folderId: string | null = null): boolean {
  if (!canSwitch()) return false;
  const cur = active();
  if (cur && cur.messages.length === 0) {
    if (cur.folderId !== folderId) moveConversation(cur.id, folderId);
    return true;
  }
  const c = blank(folderId, topOrder(get().conversations));
  set({ conversations: { ...get().conversations, [c.id]: c } });
  show(c.id);
  return true;
}

export function switchConversation(id: string): boolean {
  if (id === get().activeId) return true;
  if (!canSwitch() || !get().conversations[id]) return false;
  show(id);
  return true;
}

function patch(id: string, fields: Partial<Conversation>) {
  const c = get().conversations[id];
  if (!c) return;
  set({ conversations: { ...get().conversations, [id]: { ...c, ...fields } } });
}

export function renameConversation(id: string, title: string): void {
  const t = title.trim();
  if (t) patch(id, { title: t.slice(0, 200) });
}

export function moveConversation(id: string, folderId: string | null): void {
  moveConversations([id], folderId);
}

/** Move several chats into a folder (or out of folders), on top of it. One state change, one save. */
export function moveConversations(ids: Iterable<string>, folderId: string | null): void {
  placeConversations(ids, folderId, FIRST);
}

/** `before` value for placeConversations: put the chats at the top of the folder. */
export const FIRST = Symbol("first");

/**
 * Put chats into `folderId`, just before the chat `before` (null = at the
 * end, FIRST = at the top). The moved chats keep their order relative to
 * each other. This is what dropping a dragged chat does.
 */
export function placeConversations(ids: Iterable<string>, folderId: string | null, before: string | null | typeof FIRST): void {
  if (folderId !== null && !get().folders.some((f) => f.id === folderId)) return;
  const all = get().conversations;
  const moving = new Set([...ids].filter((id) => all[id]));
  if (moving.size === 0) return;

  // The target folder's chats as listed, without the ones being moved.
  const group = Object.values(all).filter((c) => (c.folderId ?? null) === folderId).sort(byOrder);
  const staying = group.filter((c) => !moving.has(c.id));
  let at: number;
  if (before === FIRST) at = 0;
  else if (before === null) at = staying.length;
  else {
    // Dropping "before" a chat that is itself being moved means: before the
    // next chat that stays put.
    const from = group.findIndex((c) => c.id === before);
    const anchor = from === -1 ? undefined : group.slice(from).find((c) => !moving.has(c.id));
    at = anchor ? staying.indexOf(anchor) : staying.length;
  }
  const moved = Object.values(all).filter((c) => moving.has(c.id)).sort(byOrder);
  const result = [...staying.slice(0, at), ...moved, ...staying.slice(at)];

  // Renumber the target folder 0, 1, 2… Orders only matter within a folder.
  const conversations = { ...all };
  result.forEach((c, i) => {
    conversations[c.id] = { ...c, folderId, order: i };
  });
  set({ conversations });
}

/**
 * Delete chats. Deleting the active one opens the most recent remaining chat
 * (or a new one). While a turn runs, the active chat is skipped.
 * Returns the ids that were deleted.
 */
export function deleteConversations(ids: Iterable<string>): string[] {
  const { conversations, activeId } = get();
  const doomed = [...new Set(ids)].filter((id) => conversations[id] && !(id === activeId && !canSwitch()));
  if (doomed.length === 0) return [];
  const rest = { ...conversations };
  for (const id of doomed) {
    delete rest[id];
    // Forget the model's side too. Best effort: offline, or an older server
    // without sessions, just leaves an orphaned log behind.
    callOperation("sessions.delete", { id }).catch(() => {});
  }
  if (!doomed.includes(activeId)) {
    set({ conversations: rest });
    return doomed;
  }
  const next = Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? blank();
  set({ conversations: { ...rest, [next.id]: next } });
  show(next.id);
  return doomed;
}

export function deleteConversation(id: string): boolean {
  return deleteConversations([id]).length > 0;
}

/** Name an untitled chat after the first thing the user said in it. */
export function titleFromFirstMessage(text: string): void {
  const c = active();
  if (!c || c.title !== UNTITLED) return;
  const line = text.trim().split("\n")[0]!.trim();
  if (!line) return;
  patch(c.id, { title: line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line });
}

// ---------------------------------------------------------------- folders

export function createFolder(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  const f: Folder = { id: uid("f"), name: n.slice(0, 80), collapsed: false, createdAt: Date.now() };
  set({ folders: [...get().folders, f] });
  return f.id;
}

function patchFolder(id: string, fields: Partial<Folder>) {
  set({ folders: get().folders.map((f) => (f.id === id ? { ...f, ...fields } : f)) });
}

export function renameFolder(id: string, name: string): void {
  const n = name.trim();
  if (n) patchFolder(id, { name: n.slice(0, 80) });
}

export function toggleFolder(id: string): void {
  const f = get().folders.find((x) => x.id === id);
  if (f) patchFolder(id, { collapsed: !f.collapsed });
}

/** Delete a folder. Its chats are kept and move out of it. */
export function deleteFolder(id: string): void {
  const conversations = Object.fromEntries(
    Object.entries(get().conversations).map(([k, c]) => [k, c.folderId === id ? { ...c, folderId: null } : c]),
  );
  set({ folders: get().folders.filter((f) => f.id !== id), conversations });
}

// ---------------------------------------------------------------- derived

export interface ConversationTotals {
  turns: number;
  outputTokens: number;
  estimated: boolean;
  /** average over turns that have a speed, weighted by their tokens */
  tokensPerSecond?: number;
  toolCalls: number;
}

export function totals(messages: ChatMessage[]): ConversationTotals {
  let turns = 0, outputTokens = 0, toolCalls = 0, rated = 0, seconds = 0, estimated = false;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.stats) continue;
    const s = m.stats;
    turns++;
    outputTokens += s.outputTokens;
    toolCalls += s.toolCalls;
    estimated ||= s.estimated;
    if (s.tokensPerSecond) {
      rated += s.outputTokens;
      seconds += s.outputTokens / s.tokensPerSecond;
    }
  }
  return { turns, outputTokens, estimated, toolCalls, tokensPerSecond: seconds > 0 ? rated / seconds : undefined };
}

/** Plain text of a chat, for search. */
export function searchText(c: Conversation): string {
  return (
    c.title + "\n" +
    c.messages.flatMap((m) => m.blocks.map((b) => (b.kind === "text" ? b.text : ""))).join("\n")
  ).toLowerCase();
}

export function relativeTime(t: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
