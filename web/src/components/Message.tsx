import { memo } from "react";
import type { ChatMessage } from "../../plugin-api";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";

function MessageImpl({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    const text = message.blocks.map((b) => ("text" in b ? b.text : "")).join("");
    return (
      <div data-message-id={message.id} data-role="user" className="flex justify-end">
        {/* Plain text, not markdown: show exactly what the user typed. */}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-raised px-3 py-2">{text}</div>
      </div>
    );
  }

  return (
    <div data-message-id={message.id} data-role="assistant" className="min-w-0">
      {message.blocks.map((b, i) => {
        switch (b.kind) {
          case "thinking":
            return <ThinkingBlock key={i} text={b.text} done={b.done} />;
          case "text":
            return <Markdown key={i} text={b.text} />;
          case "tool":
            return (
              <ToolCard key={b.id} id={b.id} name={b.name} args={b.args} done={b.done} isError={b.isError} result={b.result} />
            );
        }
      })}
      {message.error && (
        <div role="alert" data-turn-error className="my-2 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger">
          {message.error}
        </div>
      )}
      {message.stopped && <div className="mt-1 text-xs italic text-muted">stopped</div>}
    </div>
  );
}

// Message objects are replaced only when they change (see store.ts), so memo
// keeps old messages from re-rendering while a new one streams.
export const Message = memo(MessageImpl);
