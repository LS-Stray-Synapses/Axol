// Event log + error list, kept outside React/Zustand on purpose: a fast stream
// can produce thousands of events, and we don't want every one of them to
// trigger a re-render just because something *might* inspect the log.

export interface LoggedEvent {
  t: number; // Date.now()
  dir: "in" | "out";
  injected?: boolean; // fed in through harnessDebug.inject, not the socket
  data: unknown; // parsed JSON, or the raw string if it wasn't JSON
}

export type ErrorKind = "validation" | "render" | "plugin" | "operation" | "connection";

export interface HarnessError {
  t: number;
  kind: ErrorKind;
  message: string;
  detail?: unknown;
}

const MAX = 2000; // ring buffer: old entries fall off so memory stays bounded
const events: LoggedEvent[] = [];
const errors: HarnessError[] = [];

export function logEvent(entry: Omit<LoggedEvent, "t">): void {
  events.push({ t: Date.now(), ...entry });
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function recordError(kind: ErrorKind, message: string, detail?: unknown): void {
  errors.push({ t: Date.now(), kind, message, detail });
  if (errors.length > MAX) errors.splice(0, errors.length - MAX);
  // Still surface it in the console - silent failures are the worst kind.
  console.warn(`[harness:${kind}] ${message}`, detail ?? "");
}

export function getEventLog(n?: number): LoggedEvent[] {
  return n === undefined ? [...events] : events.slice(-n);
}

export function getErrors(): HarnessError[] {
  return [...errors];
}
