// Renders the ghost replay (#APEX-9) in headless Chromium and saves evidence.
// WebGL2 runs on SwiftShader (software) so it works without a GPU.
//
//   bun run screenshot:ghost   # builds, then runs this
//
// `?race=<stage>&ghost=<seed>` records a deterministic reference run in-process
// and replays it as a semi-transparent ghost over the live race. This script
// proves the ghost overlay is wired in the real build and captures it.
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

const STAGE = "alpine-forest";
const GHOST_SEED = 7;

try {
  await mkdir(outDir, { recursive: true });
  const problems = [];

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  const started = Date.now();
  await page.goto(`${origin}/?race=${STAGE}&ghost=${GHOST_SEED}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const start = await page.evaluate(() => ({
    webgl2: !!document.getElementById("app")?.getContext("webgl2"),
    carCount: window.apexRace?.scene.carCount ?? 0,
    circuitId: window.apexRace?.scene.circuitId ?? null,
    ghostFinishOrder: window.apexRace?.scene.ghostFinishOrder() ?? null,
  }));
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    simTime: window.apexRace?.scene.simulationTime ?? 0,
    ghostFinishOrder: window.apexRace?.scene.ghostFinishOrder() ?? null,
  }));

  const file = join(outDir, "APEX-9-ghost.png");
  await page.screenshot({ path: file });

  const ok =
    problems.length === 0 &&
    start.webgl2 &&
    start.carCount === 4 &&
    start.circuitId === STAGE &&
    Array.isArray(start.ghostFinishOrder) &&
    start.ghostFinishOrder.length === 4 &&
    after.simTime > 0;

  console.log(
    JSON.stringify(
      { ok, origin, stage: STAGE, ghostSeed: GHOST_SEED, ms: Date.now() - started, file, start, after, problems },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
