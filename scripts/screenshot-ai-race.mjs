// Renders the visible CPU race (#APEX-7) in headless Chromium and saves evidence.
// WebGL2 runs on SwiftShader (software) so it works without a GPU.
//
//   bun run build && bun scripts/screenshot-ai-race.mjs
//
// Output: docs/evidence/APEX-7-race-<id>.png for two stages, proving four CPU
// cars drive the racing line in the real build.
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

const STAGES = ["alpine-forest", "canyon-sprint"];

try {
  await mkdir(outDir, { recursive: true });
  const results = [];
  const problems = [];

  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => problems.push(`${stage} pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`${stage} console: ${msg.text()}`);
    });

    await page.goto(`${origin}/?race=${stage}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const start = await page.evaluate(() => ({
      webgl2: !!document.getElementById("app")?.getContext("webgl2"),
      carCount: window.apexRace?.scene.carCount ?? 0,
      circuitId: window.apexRace?.scene.circuitId ?? null,
    }));
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({
      simTime: window.apexRace?.scene.simulationTime ?? 0,
      leaderProgress: window.apexRace?.scene.leaderProgress ?? 0,
      leaderId: window.apexRace?.scene.leaderId ?? null,
    }));
    const file = join(outDir, `APEX-7-race-${stage}.png`);
    await page.screenshot({ path: file });
    results.push({ stage, file, start, after });
    await page.close();
  }

  const ok =
    problems.length === 0 &&
    results.every(
      (r) =>
        r.start.webgl2 &&
        r.start.carCount === 4 &&
        r.start.circuitId === r.stage &&
        r.after.leaderProgress > 0.03,
    );

  console.log(JSON.stringify({ ok, origin, results, problems }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
