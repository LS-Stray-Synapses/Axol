import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Message } from "./Message";

const STICK_PX = 48; // "near the bottom" tolerance

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Follow new output only while the user is at the bottom. Scrolling up to
  // read something turns following off; scrolling back down turns it on again.
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    // Only an *upward* scroll means "the user wants to read back". Checking
    // "am I near the bottom?" alone isn't enough: during a fast stream the
    // content can grow by more than STICK_PX between our own scroll-to-bottom
    // and the scroll event it causes, which would look like the user left.
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      if (el.scrollHeight - top - el.clientHeight < STICK_PX) stick.current = true;
      else if (top < lastTop) stick.current = false;
      lastTop = top;
    };
    // The wheel event arrives before the scroll it causes, so following stops
    // immediately instead of fighting the user for one frame.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stick.current = false;
    };
    // Watch the content's size rather than the message list: streaming text,
    // a highlighted code block or an expanded tool result all change the
    // height without changing `messages` in a way this component sees.
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    ro.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={scroller} data-chat className="min-h-0 flex-1 overflow-y-auto">
      <div ref={content} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.length === 0 && (
          <div className="mt-20 text-center text-muted">
            <p className="text-lg">Say something to the agent.</p>
            <p className="mt-2 text-sm">
              With the mock server, try <code className="font-mono">/scenario tools</code>,{" "}
              <code className="font-mono">approval</code>, <code className="font-mono">long</code>,{" "}
              <code className="font-mono">plugin_healthy</code>…
            </p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
