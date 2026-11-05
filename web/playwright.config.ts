import { defineConfig } from "@playwright/test";

// Playwright starts both servers (or reuses ones you already have running):
// the Python mock back end and the Vite dev server that proxies to it.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // one mock server, one browser page at a time keeps logs readable
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: ".venv/bin/uvicorn mock_server:app --port 8000", // cwd is the repo root
      cwd: "..",
      url: "http://127.0.0.1:8000/plugins/example-tab/ui.js",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npx vite --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
