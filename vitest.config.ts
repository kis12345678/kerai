import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for the pure server-side logic modules (agent routing, critic, tool risk,
// history compaction). Runs in Node — no DOM, no Next server needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
