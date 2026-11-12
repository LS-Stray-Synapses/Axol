// Routes validated server events to whoever owns them. Kept separate from
// main.tsx so tests and harnessDebug can use the exact same wiring.

import { addApproval, clearApprovals } from "./approvals";
import { cancel, changeModel, connect, onConnectionChange, onEvent, sendMessage } from "./backend";
import { loadPlugin, unloadPlugin } from "./plugins";
import { addUserMessage, applyServerEvent, markCancelRequested, setConnectionState, setSelectedModel, useStore } from "./store";

export function wire(): () => void {
  const offEvent = onEvent((e) => {
    switch (e.type) {
      case "approval_request":
        addApproval(e);
        break;
      case "plugin_loaded":
        void loadPlugin(e.name, e.ui_url);
        break;
      case "plugin_unloaded":
        unloadPlugin(e.name);
        break;
      default:
        applyServerEvent(e);
    }
    // A turn that ended can't still be waiting for a yes/no.
    if ((e.type === "status" && e.state === "idle") || e.type === "done" || e.type === "error") clearApprovals();
  });

  const offConn = onConnectionChange((s) => {
    setConnectionState(s);
    if (s !== "open") clearApprovals();
  });

  return () => {
    offEvent();
    offConn();
  };
}

export function startConnection(): void {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  connect(`${proto}//${window.location.host}/ws`);
}

/** What the composer (and harnessDebug.runScenario) calls. */
export function submitUserMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || useStore.getState().running) return false;
  if (!sendMessage(trimmed)) return false;
  addUserMessage(trimmed);
  return true;
}
export function selectModel(model: string): void {
  if (!model || model === useStore.getState().selectedModel) return;
  if (!changeModel(model)) return;
  setSelectedModel(model);
}

export function stopTurn(): void {
  markCancelRequested();
  cancel();
}
