// Syntax highlighting with shiki, loaded lazily: it's the heaviest dependency,
// and most turns have no code at all. We use shiki's token API (not its HTML
// output) so React builds the DOM and we never inject an HTML string.

import { useEffect, useState } from "react";
import type { HighlighterCore } from "shiki/core";

const LANGS: Record<string, string> = {
  py: "python",
  python: "python",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  json: "json",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  html: "html",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  diff: "diff",
  sql: "sql",
};
export const THEME = "github-dark";

let promise: Promise<HighlighterCore> | null = null;
let ready: HighlighterCore | null = null;

function load(): Promise<HighlighterCore> {
  promise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    // The JS regex engine avoids shipping a WASM file; fine for the handful of
    // languages a chat needs.
    ready = await createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import("shiki/themes/github-dark.mjs")],
      langs: [
        import("shiki/langs/python.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/jsx.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/sql.mjs"),
      ],
    });
    return ready;
  })();
  return promise;
}

/** The highlighter once loaded, null until then (callers render plain text meanwhile). */
export function useHighlighter(): HighlighterCore | null {
  const [hl, setHl] = useState(ready);
  useEffect(() => {
    if (hl) return;
    let alive = true;
    load().then(
      (h) => alive && setHl(h),
      () => {}, // highlighting is a nicety; plain text is a fine fallback
    );
    return () => {
      alive = false;
    };
  }, [hl]);
  return hl;
}

export function resolveLang(lang: string | undefined): string | null {
  return lang ? (LANGS[lang.toLowerCase()] ?? null) : null;
}
