// Renders the visible CPU race at chosen difficulty tiers (#APEX-8) in headless
// Chromium (SwiftShader WebGL2) and saves evidence PNGs.
//
//   bun run build && bun scripts/screenshot-difficulty.mjs
//
// Output: docs/evidence/APEX-8-race-<tier>.png. Exits non-zero if the page errors
// or the four-car field does not start/advance — proving `?difficulty=` wiring and
// that a tier does not break the visible scene.
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
const TIERS = ["easy", "rally-legend"];

try {
  await mkdir(outDir, { recursive: true });
  const results = [];
  const problems = [];

  for (const tier of TIERS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => problems.push(`${tier} pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`${tier} console: ${msg.text()}`);
    });

    await page.goto(`${origin}/?race=${STAGE}&difficulty=${tier}`, { waitUntil: "load" });
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
    }));
    const file = join(outDir, `APEX-8-race-${tier}.png`);
    await page.screenshot({ path: file });
    results.push({ tier, file, start, after });
    await page.close();
  }

  const ok =
    problems.length === 0 &&
    results.every(
      (r) =>
        r.start.webgl2 &&
        r.start.carCount === 4 &&
        r.start.circuitId === STAGE &&
        r.after.leaderProgress > 0.03,
    );

  console.log(JSON.stringify({ ok, stage: STAGE, origin, results, problems }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
