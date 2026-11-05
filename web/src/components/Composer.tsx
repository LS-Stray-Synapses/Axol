import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Slot } from "../slots";
import { useStore } from "../store";
import { stopTurn, submitUserMessage } from "../wiring";

export function Composer() {
  const running = useStore((s) => s.running);
  const connected = useStore((s) => s.connection === "open");
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const disabled = running || !connected;

  // Grow with the content up to a cap, then scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  // Give focus back when a turn ends, so the next message can be typed right away.
  useEffect(() => {
    if (!disabled) box.current?.focus();
  }, [disabled]);

  function send() {
    if (submitUserMessage(text)) setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter that confirms an IME candidate (Chinese, Japanese…) isn't "send".
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-border bg-panel px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Slot name="composer.actions" max={2} menuPlacement="up" className="flex items-center gap-1 pb-1.5" />
        <textarea
          ref={box}
          data-composer
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={!connected ? "Not connected…" : running ? "Agent is working…" : "Message (Enter to send, Shift+Enter for newline)"}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 outline-none focus:border-accent disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            data-stop
            onClick={stopTurn}
            className="h-10 rounded-md border border-danger/60 px-4 text-danger hover:bg-danger/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            data-send
            onClick={send}
            disabled={disabled || !text.trim()}
            className="h-10 rounded-md bg-accent px-4 font-medium text-bg disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
