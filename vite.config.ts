import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Apex Rally — Vite app shell. The renderer, loop and scene all live under
// `src/engine`; `index.html` only carries the single boot canvas (#app).
//
// `base: "./"` keeps every asset URL relative to the document, so the same build
// runs from the dev server, a file server, or a GitHub Pages project site
// (`/rally-racing/`) without a rebuild (#APEX-24).
//
// The content-addressed asset pipeline (#APEX-6) writes `assets/dist/` outside
// Vite's module graph. `apex-asset-dist` serves it at `/assets/*` in dev/preview
// and copies it into `dist/assets/` on build, so the runtime audio loader
// (#APEX-17) and any future glTF/KTX2 loader can fetch `assets/manifest.json`.

const ASSET_DIST = resolve(process.cwd(), "assets/dist");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

function serveAssetDist(): (req: unknown, res: unknown, next: () => void) => void {
  return (req, res, next) => {
    const request = req as { url?: string };
    const response = res as {
      setHeader(name: string, value: string): void;
      end(body: Uint8Array): void;
    };
    const pathname = (request.url ?? "").split("?")[0] ?? "";
    if (!pathname.startsWith("/assets/")) return next();
    const candidate = normalize(join(ASSET_DIST, pathname.slice("/assets/".length)));
    // Contain reads inside assets/dist (no path traversal).
    if (!candidate.startsWith(ASSET_DIST)) return next();
    try {
      if (!statSync(candidate).isFile()) return next();
    } catch {
      return next();
    }
    response.setHeader("Content-Type", CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream");
    response.end(readFileSync(candidate));
  };
}

function apexAssetDist(): Plugin {
  return {
    name: "apex-asset-dist",
    configureServer(server) {
      server.middlewares.use(serveAssetDist());
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveAssetDist());
    },
    closeBundle() {
      if (existsSync(ASSET_DIST)) {
        cpSync(ASSET_DIST, resolve(process.cwd(), "dist/assets"), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [apexAssetDist()],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
