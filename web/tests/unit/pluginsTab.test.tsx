import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A back end that has no plugins.* operations at all (like an early real server).
vi.mock("../../src/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/backend")>()),
  callOperation: async (name: string) => {
    throw new Error(`unknown operation '${name}'`);
  },
  reportPluginError: () => true,
}));

import { PluginsTab } from "../../src/builtin/PluginsTab";
import { loadPlugin } from "../../src/plugins";
import { _resetSlots, listSlots } from "../../src/slots";
import { useStore } from "../../src/store";

afterEach(() => act(() => _resetSlots()));

describe("PluginsTab without server support", () => {
  it("still lists loaded plugins and unloads them in the browser", async () => {
    act(() => useStore.setState({ connection: "open" }));
    await act(() =>
      loadPlugin("p", "/plugins/p/ui.js", async () => ({
        activate(h: import("../../plugin-api").Harness) {
          h.slots.register("header.actions", { id: "x", render: () => null });
        },
      })),
    );
    render(<PluginsTab />);
    expect(await screen.findByText(/Server can't list plugins/)).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByText("Unload")));
    expect(useStore.getState().plugins.p).toBeUndefined();
    expect(listSlots()["header.actions"]).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("removed in this browser only");
  });
});
