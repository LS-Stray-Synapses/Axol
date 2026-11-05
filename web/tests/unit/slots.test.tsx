import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture plugin_error reports instead of sending them over a socket.
const reported = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../src/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/backend")>()),
  reportPluginError: (...args: unknown[]) => {
    reported.push(args);
    return true;
  },
}));

import { getErrors } from "../../src/diagnostics";
import { _resetSlots, listSlots, register, Slot } from "../../src/slots";
import { ToolCard } from "../../src/components/ToolCard";

afterEach(() => {
  act(() => _resetSlots());
  reported.length = 0;
});

describe("slot registry", () => {
  it("register adds an entry, sorted by order; undo removes it (idempotently)", () => {
    const u1 = register("header.actions", { id: "b", render: () => null });
    const u2 = register("header.actions", { id: "a", order: 5, render: () => null }, "my-plugin");
    expect(listSlots()["header.actions"]).toEqual([
      { id: "a", order: 5, plugin: "my-plugin" },
      { id: "b", order: 100, plugin: "core" },
    ]);
    u2();
    u2();
    expect(listSlots()["header.actions"]).toEqual([{ id: "b", order: 100, plugin: "core" }]);
    u1();
    expect(listSlots()["header.actions"]).toEqual([]);
  });

  it("refuses unknown slots at runtime (plain-JS plugins skip the typecheck)", () => {
    // @ts-expect-error - unknown slot is a compile error too
    expect(() => register("nope", { id: "x", render: () => null })).toThrow("unknown slot");
  });

  it("warns about duplicate ids in a list slot (but still registers)", () => {
    const before = getErrors().length;
    register("sidebar.tabs", { id: "dup", title: "One", render: () => null }, "plugin-a");
    register("sidebar.tabs", { id: "dup", title: "Two", render: () => null }, "plugin-b");
    const added = getErrors().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.message).toContain("duplicate id 'dup'");
    expect(added[0]!.message).toContain("plugin-a");
    expect(listSlots()["sidebar.tabs"]).toHaveLength(2);
  });

  it("does not warn when a tool.renderer overrides another (that's the point of keyed slots)", () => {
    const before = getErrors().length;
    register("tool.renderer", { tool: "x", render: () => null });
    register("tool.renderer", { tool: "x", render: () => null });
    expect(getErrors().length).toBe(before);
  });

  it("rejects an entry without a render function", () => {
    // @ts-expect-error - plain-JS plugins can get this wrong
    expect(() => register("header.actions", { id: "x", render: "<b>hi</b>" }, "js-plugin")).toThrow(
      "needs a render function",
    );
  });

  it("<Slot max> shows the first N inline and the rest behind a ⋯ menu", () => {
    act(() => {
      for (let i = 1; i <= 5; i++) {
        register("header.actions", { id: `e${i}`, order: i, render: () => <span>entry {i}</span> });
      }
    });
    render(<Slot name="header.actions" max={2} />);
    expect(screen.getByText("entry 1")).toBeTruthy();
    expect(screen.getByText("entry 2")).toBeTruthy();
    expect(screen.queryByText("entry 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(screen.getByRole("menu").textContent).toBe("entry 3entry 4entry 5");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("<Slot> re-renders when registrations change", () => {
    render(<Slot name="header.actions" />);
    expect(screen.queryByText("hello")).toBeNull();
    let undo!: () => void;
    act(() => {
      undo = register("header.actions", { id: "h", render: () => <span>hello</span> });
    });
    expect(screen.getByText("hello")).toBeTruthy();
    act(() => undo());
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("a throwing entry shows an error box, reports it, and siblings still render", () => {
    act(() => {
      register("header.actions", { id: "ok1", order: 1, render: () => <span>first</span> });
      register(
        "header.actions",
        {
          id: "boom",
          order: 2,
          render: () => {
            throw new Error("kaboom");
          },
        },
        "bad-plugin",
      );
      register("header.actions", { id: "ok2", order: 3, render: () => <span>third</span> });
    });
    render(<Slot name="header.actions" />);
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("third")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("kaboom");
    expect(reported).toEqual([["bad-plugin", "header.actions", "kaboom"]]);
  });

  it("tool.renderer: latest registration wins, undo falls back, crash falls back to the default card", () => {
    const props = { id: "t1", name: "list_files", args: {}, done: true, isError: false, result: "a.txt" };
    const { container, rerender } = render(<ToolCard {...props} />);
    expect(container.querySelector("[data-tool-card]")).toBeTruthy();

    let undoB!: () => void;
    act(() => {
      register("tool.renderer", { tool: "list_files", render: () => <b>renderer A</b> });
      undoB = register("tool.renderer", { tool: "list_files", render: () => <b>renderer B</b> });
    });
    rerender(<ToolCard {...props} />);
    expect(screen.getByText("renderer B")).toBeTruthy();

    act(() => undoB()); // B goes away → A is back
    expect(screen.getByText("renderer A")).toBeTruthy();

    act(() => {
      _resetSlots();
      register("tool.renderer", {
        tool: "list_files",
        render: () => {
          throw new Error("renderer bug");
        },
      });
    });
    // error box + the default card, so the result is still visible
    expect(screen.getByRole("alert").textContent).toContain("renderer bug");
    expect(container.querySelector("[data-tool-card] [data-tool-result]")?.textContent).toBe("a.txt");
  });
});
