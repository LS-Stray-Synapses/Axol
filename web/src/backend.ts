// The ONLY module that touches the WebSocket. Everything else in the UI talks
// to the back end through these functions, which is what lets us swap the mock
// server for the real one without the UI noticing.

import { parseServerEvent, parseServerFrame, type ClientEvent, type ServerEvent } from "./contract";
import { logEvent, recordError } from "./diagnostics";

export type ConnectionState = "connecting" | "open" | "closed";

/** The slice of the browser WebSocket API we use, so tests can pass a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1; // WebSocket.OPEN, spelled out so fakes don't need the global
const OPERATION_TIMEOUT_MS = 10_000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 10_000;

let socket: SocketLike | null = null;
let connection: ConnectionState = "closed";
let wantOpen = false; // false after disconnect(): stops auto-reconnect
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let opCounter = 0;

const eventHandlers = new Set<(e: ServerEvent) => void>();
const connectionHandlers = new Set<(s: ConnectionState) => void>();
const pendingOps = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function setConnection(next: ConnectionState) {
  if (next === connection) return;
  connection = next;
  for (const h of connectionHandlers) h(next);
}

export function getConnection(): ConnectionState {
  return connection;
}

// ---------------------------------------------------------------- connecting

export function connect(url: string, createSocket: SocketFactory = (u) => new WebSocket(u)): void {
  wantOpen = true;
  clearTimeout(retryTimer);
  socket?.close();
  setConnection("connecting");

  const ws = createSocket(url);
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return; // a newer connect() replaced us
    retries = 0;
    setConnection("open");
  };
  ws.onmessage = (ev) => {
    if (socket !== ws) return;
    receive(typeof ev.data === "string" ? ev.data : String(ev.data), false);
  };
  ws.onerror = () => {
    // Browsers give no detail here; onclose always follows, so handle it there.
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    setConnection("closed");
    failPendingOps("connection closed");
    if (!wantOpen) return;
    // Exponential backoff with jitter, so a restarting server isn't hammered
    // and many tabs don't all reconnect in the same millisecond.
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** retries) * (0.75 + Math.random() * 0.5);
    retries++;
    retryTimer = setTimeout(() => connect(url, createSocket), delay);
  };
}

export function disconnect(): void {
  wantOpen = false;
  clearTimeout(retryTimer);
  const ws = socket;
  socket = null;
  ws?.close();
  setConnection("closed");
  failPendingOps("disconnected");
}

// ---------------------------------------------------------------- incoming

/**
 * Validate one incoming frame and hand it to every subscriber. Also the entry
 * point for harnessDebug.inject, so injected events take the exact same path.
 * A bad frame is recorded and dropped - it must never throw into the socket.
 */
export function receive(data: unknown, injected: boolean): void {
  let parsedForLog: unknown = data;
  let result;
  if (typeof data === "string") {
    result = parseServerFrame(data);
    try {
      parsedForLog = JSON.parse(data);
    } catch {
      /* keep the raw string in the log */
    }
  } else {
    result = parseServerEvent(data);
  }
  logEvent({ dir: "in", data: parsedForLog, ...(injected ? { injected } : {}) });

  if (!result.ok) {
    recordError("validation", result.error, parsedForLog);
    return;
  }
  const event = result.event;
  if (event.type === "operation_result") settleOperation(event);

  for (const h of eventHandlers) {
    // One broken subscriber must not stop the others from seeing the event.
    try {
      h(event);
    } catch (err) {
      recordError("render", `event handler threw on '${event.type}': ${String(err)}`, err);
    }
  }
}

export function onEvent(handler: (e: ServerEvent) => void): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

export function onConnectionChange(handler: (s: ConnectionState) => void): () => void {
  connectionHandlers.add(handler);
  return () => connectionHandlers.delete(handler);
}

// ---------------------------------------------------------------- outgoing

function send(event: ClientEvent): boolean {
  logEvent({ dir: "out", data: event });
  if (!socket || socket.readyState !== OPEN) {
    recordError("connection", `not connected, dropped outgoing '${event.type}'`, event);
    return false;
  }
  socket.send(JSON.stringify(event));
  return true;
}

export function sendMessage(text: string): boolean {
  return send({ type: "user_message", text });
}

export function replyApproval(id: string, approved: boolean): boolean {
  return send({ type: "approval_reply", id, approved });
}

export function cancel(): boolean {
  return send({ type: "cancel" });
}

export function reportPluginError(name: string, slot: string, error: string): boolean {
  return send({ type: "plugin_error", name, slot, error });
}

/** Ask the back end to do something (read memory, list tools, …) and await the answer. */
export function callOperation(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  // A counter rather than crypto.randomUUID(): that one only exists on
  // https/localhost, and this page may be opened over plain http on a LAN.
  const request_id = `op-${++opCounter}-${Date.now().toString(36)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOps.delete(request_id);
      reject(new Error(`operation '${name}' timed out after ${OPERATION_TIMEOUT_MS / 1000}s`));
    }, OPERATION_TIMEOUT_MS);
    pendingOps.set(request_id, { resolve, reject, timer });
    if (!send({ type: "call_operation", request_id, name, args })) {
      clearTimeout(timer);
      pendingOps.delete(request_id);
      reject(new Error(`operation '${name}' failed: not connected`));
    }
  });
}

function settleOperation(e: Extract<ServerEvent, { type: "operation_result" }>) {
  const pending = pendingOps.get(e.request_id);
  if (!pending) return; // late reply after a timeout, or not ours
  pendingOps.delete(e.request_id);
  clearTimeout(pending.timer);
  if (e.ok) pending.resolve(e.result);
  else pending.reject(new Error(e.error ?? "operation failed"));
}

function failPendingOps(reason: string) {
  for (const [id, p] of pendingOps) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pendingOps.delete(id);
  }
}
