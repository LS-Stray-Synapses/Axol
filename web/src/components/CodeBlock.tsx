import { useMemo, useState } from "react";
import { resolveLang, THEME, useHighlighter } from "./highlight";

export function CodeBlock({ code, lang }: { code: string; lang?: string | undefined }) {
  const hl = useHighlighter();
  const shikiLang = resolveLang(lang);
  const [copied, setCopied] = useState(false);

  // Tokens are plain {content, color} objects; we render them as <span>s.
  const lines = useMemo(() => {
    if (!hl || !shikiLang) return null;
    try {
      return hl.codeToTokens(code, { lang: shikiLang, theme: THEME }).tokens;
    } catch {
      return null;
    }
  }, [hl, shikiLang, code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API needs a secure context (https or localhost).
      setCopied(false);
    }
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border bg-[#0b0e14]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-muted">
        <span>{lang ?? "text"}</span>
        <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 hover:bg-raised hover:text-fg">
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[0.85em] leading-snug text-[#e1e4e8]">
        <code>
          {lines
            ? lines.map((line, i) => (
                <span key={i} className="block min-h-[1lh]">
                  {line.map((tok, j) => (
                    <span key={j} style={{ color: tok.color }}>
                      {tok.content}
                    </span>
                  ))}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}
