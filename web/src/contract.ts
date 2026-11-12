// The event contract between the browser and the Python back end.
// This file is the single source of truth: if the back end changes what it
// sends, this is the one place to update. Types describe the shape at compile
// time; the `check` tables below enforce the same shape at runtime, because
// TypeScript types vanish once the code runs and the socket can send anything.

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

// ---------------------------------------------------------------- server → browser

export type ServerEvent =
  | { type: "status"; state: "idle" | "running" }
  | { type: "model_list"; models: Array<{ name: string; label: string }>; selected: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; is_error: boolean }
  | { type: "approval_request"; id: string; tool: string; args: Record<string, unknown>; reason: string }
  | { type: "done"; usage?: Usage }
  | { type: "error"; message: string }
  | { type: "operation_result"; request_id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "plugin_loaded"; name: string; ui_url: string }
  | { type: "plugin_unloaded"; name: string };

export type ServerEventType = ServerEvent["type"];
export type EventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;

// ---------------------------------------------------------------- browser → server

export type ClientEvent =
  | { type: "user_message"; text: string;}
  | { type: "model_change"; model: string }
  | { type: "approval_reply"; id: string; approved: boolean }
  | { type: "cancel" }
  | { type: "call_operation"; request_id: string; name: string; args: Record<string, unknown> }
  | { type: "plugin_error"; name: string; slot: string; error: string };

// ---------------------------------------------------------------- runtime validation

type Check = (v: unknown) => boolean;

const str: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const present: Check = (v) => v !== undefined;
const obj: Check = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const optional = (c: Check): Check => (v) => v === undefined || c(v);
const oneOf = (...xs: unknown[]): Check => (v) => xs.includes(v);
const usage: Check = (v) =>
  obj(v) && num((v as Usage).input_tokens) && num((v as Usage).output_tokens);

const modelEntry: Check = (v) =>
  obj(v) &&
  str((v as { name?: unknown }).name) &&
  str((v as { label?: unknown }).label);

const modelList: Check = (v) =>
  Array.isArray(v) && v.every((item) => modelEntry(item));

// Plugin code runs inside the page with full access, so only accept plugin
// URLs from our own server's /plugins/ folder, never an arbitrary origin.
// (Not part of the contract table, but a policy the browser enforces.)
const pluginUrl: Check = (v) => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/plugins/");
  } catch {
    return false;
  }
};

// One row per event type: field name → check. The mapped type forces this
// table to list every event type, so adding one to ServerEvent without
// validating it is a compile error.
const SERVER_CHECKS: { [T in ServerEventType]: Record<Exclude<keyof EventOf<T>, "type">, Check> } = {
  status: { state: oneOf("idle", "running") },
  model_list: { models: modelList, selected: str },
  thinking: { text: str },
  text: { text: str },
  tool_call: { id: str, name: str, args: obj },
  tool_result: { id: str, name: str, result: present, is_error: bool },
  approval_request: { id: str, tool: str, args: obj, reason: str },
  done: { usage: optional(usage) },
  error: { message: str },
  operation_result: { request_id: str, ok: bool, result: optional(present), error: optional(str) },
  plugin_loaded: { name: str, ui_url: pluginUrl },
  plugin_unloaded: { name: str },
};

export type Parsed<T> = { ok: true; event: T } | { ok: false; error: string };

/** Validate one already-JSON-parsed value. Never throws. */
export function parseServerEvent(raw: unknown): Parsed<ServerEvent> {
  if (!obj(raw)) return { ok: false, error: "event is not a JSON object" };
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string") return { ok: false, error: "event has no string 'type'" };
  if (!Object.hasOwn(SERVER_CHECKS, type)) return { ok: false, error: `unknown event type '${type}'` };

  const checks = SERVER_CHECKS[type as ServerEventType] as Record<string, Check>;
  for (const [field, check] of Object.entries(checks)) {
    if (!check((raw as Record<string, unknown>)[field])) {
      return { ok: false, error: `'${type}' has missing or invalid field '${field}'` };
    }
  }
  return { ok: true, event: raw as ServerEvent };
}

/** Validate a raw socket frame (string). Never throws. */
export function parseServerFrame(frame: string): Parsed<ServerEvent> {
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return { ok: false, error: "frame is not valid JSON" };
  }
  return parseServerEvent(raw);
}