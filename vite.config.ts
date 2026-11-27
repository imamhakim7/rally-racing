import { defineConfig } from "vite";

// Apex Rally — Vite app shell. The renderer, loop and scene all live under
// `src/engine`; `index.html` only carries the single boot canvas (#app).
//
// `base: "./"` keeps every asset URL relative to the document, so the same build
// runs from the dev server, a file server, or a GitHub Pages project site
// (`/rally-racing/`) without a rebuild (#APEX-24).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
