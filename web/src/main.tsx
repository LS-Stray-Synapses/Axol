import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerBuiltins } from "./builtin";
import { startConnection, wire } from "./wiring";
import "./index.css";

// Order matters a little: subscribe before connecting, so not even the first
// event can slip past the store.
wire();
registerBuiltins();
startConnection();

if (import.meta.env.DEV) {
  // Dynamic import: debug.ts (and its self-test) is left out of production builds.
  void import("./debug").then((m) => m.installDebug());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
