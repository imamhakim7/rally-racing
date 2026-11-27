// Renders the built app in headless Chromium and saves a screenshot as evidence.
// WebGL2 runs on SwiftShader (software) so it works without a GPU.
//
//   bun run build && bun scripts/screenshot.mjs
//
// Output: docs/evidence/APEX-2-scene.png, docs/evidence/APEX-2-drift.png
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const outFile = join(outDir, "APEX-2-scene.png");
const driftFile = join(outDir, "APEX-2-drift.png");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let filePath = normalize(join(distRoot, urlPath === "/" ? "index.html" : urlPath));
    // Confine to distRoot: an exact match or a child path — never a sibling
    // whose name merely shares the prefix (e.g. distRoot="…/dist", "…/dist-x").
    if (filePath !== distRoot && !filePath.startsWith(distRoot + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  // Let the rAF loop run a few hundred ms so shadows + interpolation settle.
  await page.waitForTimeout(1000);

  const readState = () =>
    page.evaluate(() => {
      const canvas = document.getElementById("app");
      const gl = canvas?.getContext("webgl2");
      const overlay = document.getElementById("debug-overlay");
      return {
        hasCanvas: !!canvas,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        webgl2: !!gl,
        renderer: gl?.getParameter(gl.RENDERER) ?? null,
        overlay: overlay?.textContent ?? null,
        surface: overlay?.getAttribute("data-surface") ?? null,
        drifting: overlay?.getAttribute("data-drifting") ?? null,
      };
    });

  const initial = await readState();

  // Drive: hold throttle + a gentle right steer so the car is clearly moving.
  await page.keyboard.down("w");
  await page.keyboard.down("d");
  await page.waitForTimeout(1800);
  await mkdir(outDir, { recursive: true });
  await page.screenshot({ path: outFile });
  const driving = await readState();

  // Handbrake flick: pull the handbrake to break the rear loose into a drift.
  await page.keyboard.down("Space");
  await page.waitForTimeout(700);
  await page.screenshot({ path: driftFile });
  const drift = await readState();

  await page.keyboard.up("Space");
  await page.keyboard.up("d");
  await page.keyboard.up("w");

  const diagnostic = { initial, driving, drift };
  console.log(
    JSON.stringify(
      { ok: problems.length === 0, outFile, driftFile, diagnostic, problems },
      null,
      2,
    ),
  );
  if (
    problems.length > 0 ||
    !diagnostic.driving.webgl2 ||
    diagnostic.driving.width === 0 ||
    diagnostic.drift.drifting !== "true"
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
