// End-to-end: a real browser against the mock server. Every scenario is run
// through the UI, then checked via harnessDebug (state) and the DOM.

import { expect, test, type Page } from "@playwright/test";
import type { HarnessDebug } from "../../src/debug";

declare global {
  interface Window {
    harnessDebug?: HarnessDebug;
    __harnessXss?: string;
  }
}

async function open(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.harnessDebug?.getState().connection === "open");
  return pageErrors;
}

/** Start a scenario; resolves with the start time, for waitIdle. */
async function start(page: Page, name: string): Promise<number> {
  const mark = await page.evaluate(() => Date.now());
  expect(await page.evaluate((n) => window.harnessDebug!.runScenario(n), name)).toBe(true);
  return mark;
}

/** Wait until the server said `status: idle` after `mark`. */
async function waitIdle(page: Page, mark: number, timeout = 20_000) {
  await page.waitForFunction(
    (m) =>
      window.harnessDebug!.getEventLog(50).some(
        (e) => e.dir === "in" && e.t >= m && (e.data as { type?: string; state?: string })?.type === "status" &&
          (e.data as { state?: string }).state === "idle",
      ),
    mark,
    { timeout },
  );
}

async function run(page: Page, name: string) {
  await waitIdle(page, await start(page, name));
}

const state = (page: Page) => page.evaluate(() => window.harnessDebug!.getState());
const lastMessage = async (page: Page) => (await state(page)).messages.at(-1)!;

test("selfTest passes on a fresh page", async ({ page }) => {
  const errors = await open(page);
  const results = await page.evaluate(() => window.harnessDebug!.selfTest());
  for (const r of results) expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  expect(results.length).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});

test("getState() has the documented shape", async ({ page }) => {
  await open(page);
  const s = await state(page);
  expect(Object.keys(s)).toEqual(expect.arrayContaining(["connection", "running", "messages", "pendingApprovals", "plugins"]));
  expect(s.connection).toBe("open");
});

test("basic: thinking, streamed markdown, highlighted code, usage", async ({ page }) => {
  await open(page);
  await run(page, "basic");
  const m = await lastMessage(page);
  expect(m.role).toBe("assistant");
  expect(m.blocks.map((b) => b.kind)).toEqual(["thinking", "text"]);
  expect(m.blocks[0]).toMatchObject({ kind: "thinking", done: true });
  expect(m.usage).toEqual({ input_tokens: 812, output_tokens: 164 });

  const msg = page.locator(`[data-message-id="${m.id}"]`);
  await expect(msg.locator("h2")).toHaveText("A streamed answer");
  await expect(msg.locator("table td").first()).toHaveText("qwen3.5:4b");
  // shiki loaded and colored the python block
  await expect(msg.locator("pre code span[style*='color']").first()).toBeVisible();
  await expect(page.locator("[data-usage]")).toContainText("812");
  await expect(page.locator("[data-composer]")).toBeEnabled();
});

test("tools: two cards, one red error", async ({ page }) => {
  await open(page);
  await run(page, "tools");
  const tools = (await lastMessage(page)).blocks.filter((b) => b.kind === "tool");
  expect(tools).toHaveLength(2);
  expect(tools.map((t) => t.kind === "tool" && t.isError)).toEqual([false, true]);
  await expect(page.locator("[data-tool-id]")).toHaveCount(2);
  await expect(page.locator('[data-tool-id="call_2"]')).toContainText("✗ error");
  await expect(page.locator('[data-tool-id="call_2"] [data-tool-result]')).toHaveText("error: no secret.txt");
});

test("approval: Enter allows (after the arming delay)", async ({ page }) => {
  await open(page);
  const mark = await start(page, "approval");
  await page.waitForFunction(() => window.harnessDebug!.getState().pendingApprovals.length === 1);
  // The card shows it's waiting on us.
  await expect(page.locator('[data-tool-id="call_w"]')).toContainText("waiting for approval");
  // Too-early Enter is ignored: protects against a keypress meant for something else.
  await page.keyboard.press("Enter");
  expect((await state(page)).pendingApprovals).toHaveLength(1);
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await waitIdle(page, mark);
  const s = await state(page);
  expect(s.pendingApprovals).toEqual([]);
  const tool = s.messages.at(-1)!.blocks.find((b) => b.kind === "tool");
  expect(tool).toMatchObject({ done: true, isError: false, result: "wrote todo.txt" });
  const out = await page.evaluate(() => window.harnessDebug!.getEventLog().filter((e) => e.dir === "out"));
  expect(out.map((e) => e.data)).toContainEqual(expect.objectContaining({ type: "approval_reply", approved: true }));
});

test("approval: Esc denies", async ({ page }) => {
  await open(page);
  const mark = await start(page, "approval");
  await page.waitForFunction(() => window.harnessDebug!.getState().pendingApprovals.length === 1);
  await page.keyboard.press("Escape");
  await waitIdle(page, mark);
  const m = await lastMessage(page);
  expect(m.blocks.find((b) => b.kind === "tool")).toMatchObject({ isError: true, result: "user denied this action" });
  expect(m.blocks.at(-1)).toMatchObject({ kind: "text", text: expect.stringContaining("denied") });
});

test("approval: Enter on a focused Deny button denies", async ({ page }) => {
  await open(page);
  const mark = await start(page, "approval");
  await page.waitForFunction(() => window.harnessDebug!.getState().pendingApprovals.length === 1);
  await page.waitForTimeout(400); // armed, so a wrong "allow" would go through
  await page.keyboard.press("Shift+Tab"); // Allow → Deny
  await page.keyboard.press("Enter");
  await waitIdle(page, mark);
  const tool = (await lastMessage(page)).blocks.find((b) => b.kind === "tool");
  expect(tool).toMatchObject({ isError: true, result: "user denied this action" });
});

test("error: partial text then an error box, composer usable again", async ({ page }) => {
  await open(page);
  await run(page, "error");
  const m = await lastMessage(page);
  expect(m.error).toContain("HTTP 500");
  expect(m.blocks[0]).toMatchObject({ kind: "text", text: expect.stringContaining("The answer is") });
  await expect(page.locator("[data-turn-error]")).toBeVisible();
  await expect(page.locator("[data-composer]")).toBeEnabled();
  expect((await state(page)).running).toBe(false);
});

test("long: ~2000 words stream in, view follows to the bottom", async ({ page }) => {
  await open(page);
  const t0 = Date.now();
  await run(page, "long");
  const m = await lastMessage(page);
  const text = m.blocks.map((b) => ("text" in b ? b.text : "")).join("");
  expect(text.split(/\s+/).length).toBeGreaterThan(1900);
  console.log(`long scenario: ${text.length} chars, ${Date.now() - t0} ms`);
  await expect(page.locator(`[data-message-id="${m.id}"] p`).last()).toContainText("40.");
  await expect
    .poll(() => page.locator("[data-chat]").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThan(5);
});

test("long: scrolling up stops autoscroll", async ({ page }) => {
  await open(page);
  const mark = await start(page, "long");
  // Wait until there's real room to scroll up; within STICK_PX of the bottom
  // counts as "at the bottom" and following would (correctly) stay on.
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-chat]")!;
    return el.scrollHeight > el.clientHeight + 1500;
  });
  expect((await state(page)).running).toBe(true); // still streaming
  await page.locator("[data-chat]").hover();
  await page.mouse.wheel(0, -100_000); // a real user scroll
  await waitIdle(page, mark);
  const distance = await page.locator("[data-chat]").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(distance).toBeGreaterThan(1000);
});

test("xss: payloads stay inert text", async ({ page }) => {
  await open(page);
  await run(page, "xss");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__harnessXss)).toBeUndefined();
  const chat = page.locator("[data-chat]");
  await expect(chat).toContainText("raw anchor");
  expect(await chat.locator("script, img, svg[onload], [onerror], [onclick]").count()).toBe(0);
  const badHrefs = await chat.evaluate((el) =>
    [...el.querySelectorAll("[href]")].map((a) => a.getAttribute("href")!).filter((h) => /^\s*javascript:/i.test(h)),
  );
  expect(badHrefs).toEqual([]);
  // The markdown image became a link, so the "tracking pixel" was never fetched.
  await expect(chat.getByText("[image: tracking pixel]")).toBeVisible();
});

test("malformed: bad frames logged, UI survives", async ({ page }) => {
  const pageErrors = await open(page);
  const before = (await page.evaluate(() => window.harnessDebug!.getErrors())).length;
  await run(page, "malformed");
  const errors = await page.evaluate(() => window.harnessDebug!.getErrors());
  expect(errors.length - before).toBe(7);
  expect(errors.every((e) => e.kind === "validation")).toBe(true);
  const m = await lastMessage(page);
  expect(m.blocks[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Seven bad frames") });
  await expect(page.locator("[data-composer]")).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("cancel: Stop ends a long stream quickly", async ({ page }) => {
  await open(page);
  const mark = await start(page, "cancel");
  await page.waitForTimeout(600);
  await page.locator("[data-stop]").click();
  const t0 = Date.now();
  await waitIdle(page, mark, 5_000);
  expect(Date.now() - t0).toBeLessThan(2_000);
  const m = await lastMessage(page);
  expect(m.stopped).toBe(true);
  const text = m.blocks.map((b) => ("text" in b ? b.text : "")).join("");
  expect(text).toContain("chunk 1.");
  expect(text).not.toContain("chunk 500.");
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
});

test("plugin: load, use its tab + tool renderer, unload cleanly", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => window.harnessDebug!.listSlots());
  await run(page, "plugin");
  await page.waitForFunction(() => window.harnessDebug!.getState().plugins["example-tab"]?.status === "active");

  await page.locator('[data-tab="example"]').click();
  await expect(page.locator("[data-example-tab]")).toBeVisible();
  await expect(page.locator("[data-example-badge]")).toBeVisible();
  // The plugin's callOperation round-trips through the back end.
  await page.locator("[data-example-tab] button").click();
  await expect(page.locator("[data-example-tab] pre")).toContainText("from a plugin");

  // Its tool.renderer replaces the default card for list_files only.
  await run(page, "tools");
  await expect(page.locator('[data-tool-id="call_1"] [data-file-list]')).toContainText("notes.md");
  await expect(page.locator('[data-tool-id="call_2"] [data-tool-card]')).toBeVisible();

  await run(page, "unplug");
  expect(await page.evaluate(() => window.harnessDebug!.listSlots())).toEqual(before);
  await expect(page.locator('[data-tab="example"]')).toHaveCount(0);
  await expect(page.locator("[data-example-badge]")).toHaveCount(0);
  expect((await state(page)).plugins).toEqual({});
});

test("plugin_crash: error box in its tab, everything else works, error reported", async ({ page }) => {
  await open(page);
  await run(page, "plugin_crash");
  await page.waitForFunction(() => window.harnessDebug!.getState().plugins["crash-tab"]?.status === "active");
  await page.locator('[data-tab="crash"]').click();
  await expect(page.locator("[data-slot-error]")).toContainText("exploded while rendering");
  await expect(page.locator("[data-crash-ok]")).toBeVisible(); // same plugin, healthy entry
  await page.locator('[data-tab="memory"]').click();
  await expect(page.locator("[data-memory-tab]")).toContainText("learning how agent harnesses work");

  // The browser told the back end (via plugin_error), and the mock recorded it.
  const reported = (await page.evaluate(() => window.harnessDebug!.callOperation("debug.plugin_errors"))) as {
    name: string;
    slot: string;
  }[];
  expect(reported).toContainEqual(expect.objectContaining({ name: "crash-tab", slot: "sidebar.tabs" }));
  // And the rest of the app still works.
  await run(page, "basic");
  await expect(page.locator("h2", { hasText: "A streamed answer" })).toBeVisible();
});

test("operations: built-in tabs + a failing operation rejects", async ({ page }) => {
  await open(page);
  await page.locator('[data-tab="tools"]').click();
  await expect(page.locator("[data-tools-tab] li")).toHaveCount(5);
  const err = await page.evaluate(() =>
    window.harnessDebug!.callOperation("debug.fail").then(
      () => "resolved?!",
      (e: Error) => e.message,
    ),
  );
  expect(err).toContain("always fails");
});

test("composer: Enter sends, Shift+Enter adds a newline", async ({ page }) => {
  await open(page);
  const box = page.locator("[data-composer]");
  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.pressSequentially("line two");
  await expect(box).toHaveValue("line one\nline two");
  const mark = await page.evaluate(() => Date.now());
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(box).toBeDisabled(); // running
  await waitIdle(page, mark);
  const user = (await state(page)).messages.find((m) => m.role === "user")!;
  expect(user.blocks[0]).toMatchObject({ text: "line one\nline two" });
});

test("many tabs + header entries: one scrolling row, ▾ / ⋯ menus, state kept, duplicate warned", async ({ page }) => {
  // Serve a fake plugin straight from the test: no file in plugins/ needed.
  await page.route("**/plugins/many/ui.js*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function activate(h) {
        const { React, html, slots } = h;
        function Counter({ label }) {
          const [n, setN] = React.useState(0);
          return html\`<button data-counter=\${label} onClick=\${() => setN(n + 1)}>\${label}: \${n}</button>\`;
        }
        for (let i = 1; i <= 12; i++) {
          slots.register("sidebar.tabs", { id: "t" + i, title: "Tab number " + i, order: 100 + i, render: () => html\`<\${Counter} label=\${"t" + i} />\` });
        }
        for (let i = 1; i <= 6; i++) {
          slots.register("header.actions", { id: "h" + i, render: () => html\`<span data-h=\${i}>H\${i}</span>\` });
        }
        slots.register("header.actions", { id: "h1", render: () => html\`<span>dup</span>\` });
      }`,
    }),
  );
  await open(page);
  await page.evaluate(() =>
    window.harnessDebug!.inject({ type: "plugin_loaded", name: "many", ui_url: "/plugins/many/ui.js" }),
  );
  await page.waitForFunction(() => window.harnessDebug!.getState().plugins.many?.status === "active");

  // Tabs: a single row (same vertical position), not wrapped.
  const tops = await page.locator('[role="tablist"] [role="tab"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(tops).toHaveLength(15); // 3 built-ins + 12
  expect(new Set(tops).size).toBe(1);

  // ▾ menu lists every tab; picking one activates it and scrolls it into view.
  await page.getByTestId("tab-menu").getByRole("button").click();
  await expect(page.getByRole("menuitem")).toHaveCount(15);
  await page.getByRole("menuitem", { name: "Tab number 12" }).click();
  await expect(page.locator('[data-counter="t12"]')).toBeVisible();
  await expect(page.locator('[data-tab="t12"]')).toBeInViewport();

  // Keep-alive: state in tab 12 survives a trip to Memory and back.
  await page.locator('[data-counter="t12"]').click();
  await page.locator('[data-counter="t12"]').click();
  await page.locator('[data-tab="memory"]').click();
  await expect(page.locator('[data-counter="t12"]')).toBeHidden();
  await page.locator('[data-tab="t12"]').click();
  await expect(page.locator('[data-counter="t12"]')).toHaveText("t12: 2");

  // Header: 4 inline, the rest (2 plugin entries, the dup, the theme toggle) behind ⋯.
  await expect(page.locator("header [data-h]")).toHaveCount(4);
  await page.getByTestId("header.actions-more").getByRole("button", { name: "4 more" }).click();
  await expect(page.getByRole("menu").locator("[data-h]")).toHaveCount(2); // H5, H6
  await expect(page.getByRole("menu")).toContainText("dup");
  await expect(page.getByRole("menu").getByTitle("toggle theme")).toBeVisible();

  // Duplicate id was reported.
  const errors = await page.evaluate(() => window.harnessDebug!.getErrors().map((e) => e.message));
  expect(errors.some((m) => m.includes("duplicate id 'h1'"))).toBe(true);

  await page.screenshot({ path: "test-results/many-tabs.png" });
});

test("plugin_healthy: tab works, header button breaks it, fix + retry brings it back", async ({ page }) => {
  await open(page);
  await run(page, "plugin_healthy");
  await page.waitForFunction(() => window.harnessDebug!.getState().plugins["healthy-tab"]?.status === "active");
  await page.locator('[data-tab="healthy"]').click();
  await expect(page.locator("[data-healthy-tab]")).toBeVisible();
  await page.locator("[data-healthy-count]").click();
  await expect(page.locator("[data-healthy-count]")).toHaveText("clicked 1 times");

  await page.locator("[data-healthy-toggle]").click(); // 💥 break tab
  await expect(page.locator("[data-slot-error]")).toContainText("broken on purpose");
  await expect(page.locator("[data-healthy-toggle]")).toHaveText("🔧 fix tab"); // the other entry still works

  await page.getByRole("button", { name: "retry" }).click(); // still broken → crashes again
  await expect(page.locator("[data-slot-error]")).toBeVisible();
  await page.locator("[data-healthy-toggle]").click(); // 🔧 fix tab
  await page.getByRole("button", { name: "retry" }).click();
  await expect(page.locator("[data-healthy-tab]")).toBeVisible();
  await expect(page.locator("[data-slot-error]")).toHaveCount(0);
});

test("Plugins tab: lists plugins/ and loads / unloads them", async ({ page }) => {
  await open(page);
  await page.locator('[data-tab="plugins"]').click();
  for (const name of ["crash-tab", "example-tab", "healthy-tab"]) {
    await expect(page.locator(`[data-plugin-row="${name}"] [data-plugin-status]`)).toHaveText("not loaded");
  }
  const row = page.locator('[data-plugin-row="example-tab"]');
  await row.locator('[data-plugin-action="load"]').click();
  await expect(row.locator("[data-plugin-status]")).toHaveText("active");
  await expect(page.locator('[data-tab="example"]')).toBeVisible();

  // A plugin loaded by a chat scenario shows up here too.
  await run(page, "plugin_healthy");
  await expect(page.locator('[data-plugin-row="healthy-tab"] [data-plugin-status]')).toHaveText("active");

  await row.locator('[data-plugin-action="unload"]').click();
  await expect(row.locator("[data-plugin-status]")).toHaveText("not loaded");
  await expect(page.locator('[data-tab="example"]')).toHaveCount(0);
  expect(Object.keys((await state(page)).plugins)).toEqual(["healthy-tab"]);
});
