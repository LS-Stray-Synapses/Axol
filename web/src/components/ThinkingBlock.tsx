import { useEffect, useState } from "react";

/** Reasoning stream: open while it's arriving, collapses once the answer starts. */
export function ThinkingBlock({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(!done);
  // Collapse exactly once, on the done transition; afterwards the user's
  // clicks decide.
  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);

  return (
    <details
      data-thinking
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="my-2 rounded-md border border-border/60 bg-panel/50 text-sm text-muted"
    >
      <summary className="cursor-pointer select-none px-3 py-1.5 italic">
        {done ? "Thought" : "Thinking…"}
        {!done && <span className="h-spinner ml-2 align-middle" />}
      </summary>
      <div className="whitespace-pre-wrap px-3 pb-2 font-mono text-xs leading-relaxed">{text}</div>
    </details>
  );
}
