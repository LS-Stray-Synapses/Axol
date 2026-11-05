import { fireEvent, render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/backend")>()),
  reportPluginError: () => true,
}));

import { Sidebar } from "../../src/components/Sidebar";
import { _resetSlots, register } from "../../src/slots";

afterEach(() => act(() => _resetSlots()));

function Counter({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {label}: {n}
    </button>
  );
}

const tab = (id: string) => screen.getByRole("tab", { name: id });

describe("Sidebar", () => {
  it("keeps a tab's state when switching away and back", () => {
    act(() => {
      register("sidebar.tabs", { id: "a", title: "A", order: 1, render: () => <Counter label="a" /> });
      register("sidebar.tabs", { id: "b", title: "B", order: 2, render: () => <Counter label="b" /> });
    });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("a: 0"));
    fireEvent.click(screen.getByText("a: 1"));
    fireEvent.click(tab("B"));
    expect(screen.getByText("b: 0")).toBeTruthy();
    fireEvent.click(tab("A"));
    expect(screen.getByText("a: 2")).toBeTruthy(); // not reset to 0
  });

  it("doesn't mount a tab until it is first opened", () => {
    const renderB = vi.fn(() => <p>B content</p>);
    act(() => {
      register("sidebar.tabs", { id: "a", title: "A", order: 1, render: () => <p>A content</p> });
      register("sidebar.tabs", { id: "b", title: "B", order: 2, render: renderB });
    });
    render(<Sidebar />);
    expect(renderB).not.toHaveBeenCalled();
    fireEvent.click(tab("B"));
    expect(renderB).toHaveBeenCalled();
  });

  it("falls back to the first tab when the active one is unregistered", () => {
    let undoB!: () => void;
    act(() => {
      register("sidebar.tabs", { id: "a", title: "A", order: 1, render: () => <p>A content</p> });
      undoB = register("sidebar.tabs", { id: "b", title: "B", order: 2, render: () => <p>B content</p> });
    });
    render(<Sidebar />);
    fireEvent.click(tab("B"));
    act(() => undoB());
    expect(screen.queryByText("B content")).toBeNull();
    expect(tab("A").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("A content").closest("[hidden]")).toBeNull();
  });

  it("a crashed tab offers retry", () => {
    let fail = true;
    function Flaky() {
      if (fail) throw new Error("flaky");
      return <p>recovered</p>;
    }
    act(() => {
      register("sidebar.tabs", { id: "f", title: "F", render: Flaky }, "flaky-plugin");
    });
    render(<Sidebar />);
    expect(screen.getByRole("alert").textContent).toContain("flaky");
    fail = false;
    fireEvent.click(screen.getByText("retry"));
    expect(screen.getByText("recovered")).toBeTruthy();
  });
});
