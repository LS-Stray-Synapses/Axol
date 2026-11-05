import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Python server (mock_server.py now, the real one later) owns /ws and
// /plugins. In dev, Vite forwards those so the browser only ever talks to one
// origin - same as in production, where FastAPI serves web/dist itself.
const BACKEND = process.env.HARNESS_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: BACKEND.replace(/^http/, "ws"), ws: true },
      "/plugins": { target: BACKEND },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/unit/setup.ts"],
  },
});
