// Renders the built app in headless Chromium and saves stage evidence.
// WebGL2 runs on SwiftShader (software) so it works without a GPU.
//
//   bun run build && bun scripts/screenshot-stage.mjs
//
// Output: docs/evidence/APEX-4-stage-<id>.png (two different stages, switched
// through the real stage-select control, proving the world swaps live).
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");

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
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => {
    const canvas = document.getElementById("app");
    const gl = canvas?.getContext("webgl2");
    const api = window.apexStage;
    return {
      hasCanvas: !!canvas,
      webgl2: !!gl,
      renderer: gl?.getParameter(gl.RENDERER) ?? null,
      stageCount: api?.library.size ?? 0,
      stages: api?.library.list().map((s) => s.id) ?? [],
      current: api?.scene.current.id ?? null,
      gateCount: api?.scene.world.gates.length ?? 0,
    };
  });

  await mkdir(outDir, { recursive: true });
  // The menus (#APEX-11) cover the canvas at boot; hide them to capture the stage.
  await page.evaluate(() => {
    if (window.apexStage?.menu) window.apexStage.menu.element.hidden = true;
  });
  const firstFile = join(outDir, `APEX-4-stage-${before.current}.png`);
  await page.screenshot({ path: firstFile });

  // Switch through the real menu control so the screenshot proves stage select.
  const target = before.stages.find((id) => id !== before.current);
  await page.evaluate(() => {
    window.apexStage?.menu?.showScreen("stage_select");
    if (window.apexStage?.menu) window.apexStage.menu.element.hidden = false;
  });
  await page.click(`.apex-card[data-stage-id="${target}"]`);
  await page.evaluate(() => {
    if (window.apexStage?.menu) window.apexStage.menu.element.hidden = true;
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    current: window.apexStage?.scene.current.id ?? null,
    gateCount: window.apexStage?.scene.world.gates.length ?? 0,
    roadVertices: (() => {
      const road = window.apexStage?.scene.world.road;
      return road?.geometry.getAttribute("position").count ?? 0;
    })(),
  }));
  const secondFile = join(outDir, `APEX-4-stage-${after.current}.png`);
  await page.screenshot({ path: secondFile });

  const ok =
    problems.length === 0 &&
    before.webgl2 &&
    before.stageCount >= 6 &&
    before.gateCount >= 2 &&
    after.current === target &&
    after.roadVertices > 0;

  console.log(
    JSON.stringify(
      { ok, origin, firstFile, secondFile, before, after, problems },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
