// Built-ins register through the same slots API as plugins (with owner
// "core"), which keeps us honest: if a built-in needs something the slot API
// can't do, a plugin couldn't do it either.

import { useState } from "react";
import type { Undo } from "../../plugin-api";
import { register } from "../slots";
import { MemoryTab } from "./MemoryTab";
import { PluginsTab } from "./PluginsTab";
import { ToolsTab } from "./ToolsTab";

function ThemeToggle() {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  function toggle() {
    const next = !light;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    setLight(next);
  }
  return (
    <button type="button" onClick={toggle} title="toggle theme" className="rounded px-1.5 text-muted hover:text-fg">
      {light ? "☾" : "☀"}
    </button>
  );
}

export function registerBuiltins(): Undo {
  const undos = [
    register("sidebar.tabs", { id: "memory", title: "Memory", order: 10, render: MemoryTab }),
    register("sidebar.tabs", { id: "tools", title: "Tools", order: 20, render: ToolsTab }),
    register("sidebar.tabs", { id: "plugins", title: "Plugins", order: 30, render: PluginsTab }),
    register("header.actions", { id: "theme", order: 1000, render: ThemeToggle }),
  ];
  return () => undos.forEach((u) => u());
}
