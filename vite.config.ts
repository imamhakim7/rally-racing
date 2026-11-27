import { defineConfig } from "vite";

// Apex Rally — Vite app shell. The renderer, loop and scene all live under
// `src/engine`; `index.html` only carries the single boot canvas (#app).
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
