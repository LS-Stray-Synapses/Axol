// Types for plugin authors: the `harness` object a plugin's activate() receives.
//
// A plugin is one plain ES module, served from the back end's /plugins/ folder,
// with no build step:
//
//   // @ts-check
//   /** @param {import("../../web/plugin-api").Harness} harness */
//   export function activate(harness) {
//     const { html, slots } = harness;
//     slots.register("sidebar.tabs", {
//       id: "hello", title: "Hello",
//       render: () => html`<p>hi</p>`,
//     });
//   }
//
// Check it with:  npx tsc --noEmit --ignoreConfig --allowJs --checkJs path/to/ui.js
// (run from web/; --ignoreConfig because TypeScript 7 refuses file arguments
// when a tsconfig.json is present. `npm run typecheck` checks every plugin).
//
// Rules a plugin must follow (the harness enforces what it can):
// - Render only through slots. No portals, no document.* access outside your
//   own element. You get React, but not ReactDOM, for that reason.
// - You cannot see, render, hide or answer the tool-approval dialog.
// - Everything you register is undone automatically when the plugin unloads.
//
// The app itself imports these types too, so this file can't drift from the code.

import type * as ReactNS from "react";
import type { ComponentType, ReactElement } from "react";

// ---------------------------------------------------------------- read-only app state

export type ConnectionState = "connecting" | "open" | "closed";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export type Block =
  | { kind: "thinking"; text: string; done: boolean }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      done: boolean; // false until tool_result arrives
      isError: boolean;
      result?: unknown;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** user messages have one text block; assistant turns interleave thinking, text and tools */
  blocks: Block[];
  error?: string;
  usage?: Usage;
  /** the user pressed Stop during this turn */
  stopped?: boolean;
}

export interface PluginInfo {
  name: string;
  ui_url: string;
  status: "loading" | "active" | "error";
  error?: string;
}

export interface PublicState {
  connection: ConnectionState;
  running: boolean;
  messages: ChatMessage[];
  /** usage reported by the last `done` event */
  usage?: Usage;
  plugins: Record<string, PluginInfo>;
}

// ---------------------------------------------------------------- slots

/**
 * A sidebar tab. It mounts the first time the user opens it and then stays
 * mounted (hidden while another tab is active), so React state survives tab
 * switches. Don't assume "visible" just because your component is mounted.
 */
export interface TabEntry {
  /** unique within the slot; a duplicate still works but is logged as an error */
  id: string;
  title: string;
  /** lower comes first; default 100 */
  order?: number;
  render: ComponentType;
}

/**
 * A small button/badge. The header shows the first 4 (by `order`) inline and
 * the composer the first 2; the rest go into a "⋯" menu.
 */
export interface ActionEntry {
  id: string;
  order?: number;
  render: ComponentType;
}

export interface ToolRendererProps {
  id: string;
  name: string;
  args: Record<string, unknown>;
  done: boolean;
  isError: boolean;
  result?: unknown;
}

export interface ToolRendererEntry {
  /** the tool name this renderer replaces the default card for */
  tool: string;
  render: ComponentType<ToolRendererProps>;
}

/** Every slot and the entry type it accepts. Unknown slots or wrong props don't typecheck. */
export interface SlotMap {
  "sidebar.tabs": TabEntry;
  "header.actions": ActionEntry;
  "composer.actions": ActionEntry;
  "tool.renderer": ToolRendererEntry;
}

export type SlotName = keyof SlotMap;

/** Calling it removes what was registered. Safe to call twice. */
export type Undo = () => void;

// ---------------------------------------------------------------- the harness object

/** CSS values like "var(--h-bg)": use them in styles and they follow theme changes. */
export interface ThemeTokens {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  danger: string;
  ok: string;
  font: string;
  mono: string;
}

export type Html = (strings: TemplateStringsArray, ...values: unknown[]) => ReactElement | ReactElement[];

export interface Harness {
  /** this plugin's name, as the back end announced it */
  readonly name: string;
  readonly React: typeof ReactNS;
  /** htm bound to React.createElement: html`<div class=${x}>…</div>` */
  readonly html: Html;
  readonly slots: {
    register<K extends SlotName>(slot: K, entry: SlotMap[K]): Undo;
  };
  /** Ask the back end for something, e.g. callOperation("memory.read"). Rejects on error or after 10 s. */
  callOperation(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Read-only React hook over the app state. Re-renders when the selected value changes. */
  useStore<T>(selector: (state: PublicState) => T): T;
  readonly theme: ThemeTokens;
}

/** What a plugin module must export. May return a cleanup function. */
export type Activate = (harness: Harness) => void | Undo | Promise<void | Undo>;

export interface PluginModule {
  activate: Activate;
}
