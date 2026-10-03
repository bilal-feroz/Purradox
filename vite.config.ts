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
    // Rapier's compat build inlines its WebAssembly (~4.3 MB, lazy-loaded chunk).
    chunkSizeWarningLimit: 4600,
    sourcemap: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
