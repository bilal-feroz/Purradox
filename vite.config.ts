import { defineConfig } from "vitest/config";

// Relative base so the production build works from any static host path
// (GitHub Pages serves this project from /Purradox/).
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
    sourcemap: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
