// The tool-approval dialog: core UI, deliberately out of reach of plugins.
//
// Plugin code runs in the same page as us, so "plugins can't touch it" needs
// a few layers, each closing one easy path:
//   1. Its state lives in approvals.ts, which isn't in the `harness` object.
//   2. It renders in its own React root inside a *closed* shadow root, so
//      document.querySelector() can't find its buttons to click or hide them.
//   3. It only reacts to trusted events (event.isTrusted: real keyboard/mouse
//      input from the browser). A plugin can dispatch a fake "Enter" keydown,
//      but it can't make it trusted.
//   4. If something removes its host element from the page, it puts it back.
//   5. Allow is ignored for a moment after the dialog appears, so an Enter
//      the user meant for something else doesn't approve by accident.
//
// This stops accidents and casual misuse. It is not a sandbox: same-page JS
// can still do a lot (in dev it could even import our modules from /src).
// Real isolation would mean running plugins in a sandboxed iframe.

import { useEffect, useRef, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { answerApproval, useApprovals, type ApprovalRequest } from "../approvals";
import { formatValue } from "./ToolCard";

const ARM_MS = 350;

// Shadow DOM doesn't see the page's Tailwind classes, so the dialog carries
// its own small stylesheet. CSS variables do cross the shadow boundary, so
// it still follows the theme tokens.
const CSS = `
dialog {
  width: min(32rem, calc(100vw - 2rem));
  padding: 0; border: 1px solid var(--h-border); border-radius: 10px;
  background: var(--h-panel); color: var(--h-fg); font-family: var(--h-font);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.5);
}
dialog::backdrop { background: rgb(0 0 0 / 0.55); }
.body { padding: 1rem 1.25rem; }
h2 { margin: 0 0 0.5rem; font-size: 1rem; font-weight: 600; }
.tool { font-family: var(--h-mono); color: var(--h-accent); }
.reason { margin: 0 0 0.75rem; color: var(--h-muted); font-size: 0.9rem; }
pre {
  margin: 0; max-height: 14rem; overflow: auto; padding: 0.6rem 0.75rem;
  background: var(--h-bg); border: 1px solid var(--h-border); border-radius: 6px;
  font-family: var(--h-mono); font-size: 0.8rem; white-space: pre-wrap; word-break: break-word;
}
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--h-border); }
button:focus-visible { outline: 2px solid var(--h-fg); outline-offset: 2px; }
button { font: inherit; font-size: 0.9rem; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
.deny { background: transparent; color: var(--h-fg); border: 1px solid var(--h-border); }
.allow { background: var(--h-accent); color: var(--h-bg); border: 1px solid var(--h-accent); font-weight: 600; }
kbd { font-family: var(--h-mono); font-size: 0.75em; opacity: 0.7; margin-left: 0.4em; }
.more { color: var(--h-muted); font-size: 0.8rem; margin-top: 0.5rem; }
`;

// Debug-only window into the dialog (debug.ts uses it for selfTest). Not
// reachable from plugins: they get the harness object, not our modules.
let currentDialog: HTMLDialogElement | null = null;
let currentHost: HTMLElement | null = null;
export function _approvalDialogStatus() {
  return {
    hostConnected: currentHost?.isConnected ?? false,
    open: currentDialog?.open ?? false,
    requestId: currentDialog?.dataset.requestId ?? null,
    modal: currentDialog ? isModal(currentDialog) : false,
  };
}

function isModal(d: HTMLDialogElement): boolean {
  try {
    return d.matches(":modal");
  } catch {
    return d.open; // environments without :modal support (jsdom)
  }
}

function Prompt({ req, queued }: { req: ApprovalRequest; queued: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const allowRef = useRef<HTMLButtonElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);
  const armed = useRef(false);

  useEffect(() => {
    const d = ref.current!;
    // showModal puts the dialog in the browser's "top layer": above any
    // z-index, with the rest of the page made inert.
    if (typeof d.showModal === "function") {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute("open", ""); // old jsdom in unit tests
    }
    // showModal focuses the first button (Deny); put focus where the
    // "Enter = allow" hint says it is.
    allowRef.current?.focus();
    currentDialog = d;
    const timer = setTimeout(() => (armed.current = true), ARM_MS);

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // Ours now: stop the composer (or anyone else) from also handling it.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.isTrusted || e.repeat) return;
      // Enter on a focused Deny button means deny: someone who tabbed there
      // must never approve by pressing Enter. (Not e.composedPath(): a
      // listener on window can't see inside a closed shadow root. Our own
      // shadow root can tell us what's focused in it, though.)
      const deny = denyRef.current;
      const onDeny = deny !== null && (deny.getRootNode() as ShadowRoot | Document).activeElement === deny;
      if (e.key === "Escape" || onDeny) answerApproval(req.id, false);
      else if (armed.current) answerApproval(req.id, true);
    }
    // Capture phase on window: we see the key before anything in the page,
    // wherever focus happens to be.
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      if (currentDialog === d) currentDialog = null;
      if (d.open && typeof d.close === "function") d.close();
    };
  }, [req.id]);

  function click(approved: boolean, e: MouseEvent) {
    if (!e.nativeEvent.isTrusted) return;
    if (approved && !armed.current) return;
    answerApproval(req.id, approved);
  }

  return (
    <dialog
      ref={ref}
      data-request-id={req.id}
      aria-labelledby="approval-title"
      // The browser's own Esc handling would close the dialog without an answer.
      onCancel={(e) => e.preventDefault()}
    >
      <div className="body">
        <h2 id="approval-title">
          Allow <span className="tool">{req.tool}</span>?
        </h2>
        {req.reason && <p className="reason">{req.reason}</p>}
        <pre>{formatValue(req.args)}</pre>
        {queued > 0 && <div className="more">{queued} more waiting</div>}
      </div>
      <div className="actions">
        <button type="button" ref={denyRef} className="deny" onClick={(e) => click(false, e)}>
          Deny<kbd>Esc</kbd>
        </button>
        <button type="button" ref={allowRef} className="allow" onClick={(e) => click(true, e)}>
          Allow<kbd>Enter</kbd>
        </button>
      </div>
    </dialog>
  );
}

function ApprovalDialog() {
  const pending = useApprovals((s) => s.pending);
  const req = pending[0];
  if (!req) return null;
  // key: a new request remounts, which re-arms the delay.
  return <Prompt key={req.id} req={req} queued={pending.length - 1} />;
}

/** Create the shadow host + separate React root. Returns a teardown function. */
export function mountApprovalDialog(): () => void {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const container = document.createElement("div");
  shadow.append(style, container);
  document.body.appendChild(host);
  currentHost = host;

  const root = createRoot(container);
  root.render(<ApprovalDialog />);

  // Removed by someone else? Put it back. MutationObserver callbacks run as a
  // microtask, i.e. before the browser paints.
  let tearingDown = false;
  const observer = new MutationObserver(() => {
    if (tearingDown || host.isConnected) return;
    document.body.appendChild(host);
    // Removing a modal dialog from the page takes it out of the top layer;
    // re-inserting doesn't put it back. Re-open it as modal.
    const d = currentDialog;
    if (d && typeof d.showModal === "function" && !isModal(d)) {
      if (d.open) d.close();
      d.showModal();
    }
  });
  observer.observe(document.body, { childList: true });

  return () => {
    tearingDown = true;
    observer.disconnect();
    // Deferred: this runs inside React's commit of the main tree (StrictMode
    // mounts effects twice in dev), and unmounting another root synchronously
    // in the middle of a render is not allowed.
    setTimeout(() => {
      root.unmount();
      host.remove();
    });
    if (currentHost === host) currentHost = null;
  };
}
