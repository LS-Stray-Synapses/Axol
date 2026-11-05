import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/backend")>()),
  reportPluginError: () => true,
}));

import type { Harness } from "../../plugin-api";
import { loadPlugin, unloadPlugin } from "../../src/plugins";
import { _resetSlots, listSlots } from "../../src/slots";
import { useStore } from "../../src/store";

afterEach(() => {
  unloadPlugin("p");
  _resetSlots();
});

/** An importer that returns a module object instead of fetching a URL. */
const fake = (activate: (h: Harness) => unknown) => async () => ({ activate });

const registerThree = (h: Harness) => {
  h.slots.register("sidebar.tabs", { id: "t", title: "T", render: () => null });
  h.slots.register("header.actions", { id: "a", render: () => null });
  h.slots.register("tool.renderer", { tool: "list_files", render: () => null });
};

describe("plugin loader", () => {
  it("activate gets the harness object, and unload undoes every registration", async () => {
    const before = listSlots();
    let got: Harness | undefined;
    await loadPlugin("p", "/plugins/p/ui.js", fake((h) => ((got = h), registerThree(h))));

    expect(got?.name).toBe("p");
    expect(typeof got?.html).toBe("function");
    expect(got?.theme.bg).toBe("var(--h-bg)");
    expect(Object.isFrozen(got)).toBe(true);
    expect(Object.values(listSlots()).flat().filter((r) => r.plugin === "p")).toHaveLength(3);
    expect(useStore.getState().plugins.p?.status).toBe("active");

    unloadPlugin("p");
    expect(listSlots()).toEqual(before);
    expect(useStore.getState().plugins.p).toBeUndefined();
  });

  it("runs the cleanup function activate returns", async () => {
    const cleanup = vi.fn();
    await loadPlugin("p", "/plugins/p/ui.js", fake(() => cleanup));
    unloadPlugin("p");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("reloading the same name replaces the old registrations", async () => {
    await loadPlugin("p", "/plugins/p/ui.js", fake(registerThree));
    await loadPlugin("p", "/plugins/p/ui.js", fake(registerThree));
    expect(Object.values(listSlots()).flat().filter((r) => r.plugin === "p")).toHaveLength(3);
  });

  it("adds a cache-busting query so a reload re-runs new code", async () => {
    const urls: string[] = [];
    await loadPlugin("p", "/plugins/p/ui.js", async (u) => (urls.push(u), { activate() {} }));
    expect(urls[0]).toMatch(/^\/plugins\/p\/ui\.js\?v=\d+$/);
  });

  it("an activate that throws is rolled back and marked as error", async () => {
    const before = listSlots();
    await loadPlugin(
      "p",
      "/plugins/p/ui.js",
      fake((h) => {
        h.slots.register("header.actions", { id: "half", render: () => null });
        throw new Error("activate failed");
      }),
    );
    expect(listSlots()).toEqual(before);
    expect(useStore.getState().plugins.p).toMatchObject({ status: "error", error: "activate failed" });
  });

  it("a module without activate() is an error, not a crash", async () => {
    await loadPlugin("p", "/plugins/p/ui.js", async () => ({ notActivate: 1 }));
    expect(useStore.getState().plugins.p?.status).toBe("error");
  });

  it("unloading while the import is in flight never activates", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const activate = vi.fn();
    const loading = loadPlugin("p", "/plugins/p/ui.js", async () => (await gate, { activate }));
    unloadPlugin("p");
    release();
    await loading;
    expect(activate).not.toHaveBeenCalled();
  });
});
