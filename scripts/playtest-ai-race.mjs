// Player playtest for #APEX-7: watches the *built, visible* CPU race in headless
// Chromium and measures what a player actually sees — how many cars are on
// screen, whether they stay on the road, the gaps between them, and whether they
// brake for corners — plus a filmstrip of frames as evidence.
//
//   bun run build && bun scripts/playtest-ai-race.mjs
//
// Output: docs/evidence/APEX-7-playtest.json and APEX-7-playtest-<stage>-t<sec>.png
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
const FRAME_TIMES = [1, 8, 16, 24];
const CORNER_CURVATURE = 0.012;

function analyse(samples) {
  const halfWidth = samples[0].roadHalfWidth;
  let maxAbsOffset = 0;
  let offRoadSamples = 0;
  let minSeparation = Infinity;
  let onScreenMinActive = Infinity;
  let onScreenSum = 0;
  let onScreenCount = 0;
  const straight = [];
  const corner = [];
  const finishTime = {};

  for (const s of samples) {
    for (const c of s.cars) {
      maxAbsOffset = Math.max(maxAbsOffset, Math.abs(c.centerOffset));
      if (Math.abs(c.centerOffset) > halfWidth + 1e-6) offRoadSamples += 1;
      if (c.finished && finishTime[c.id] === undefined) finishTime[c.id] = s.time;
      if (s.time > 3) {
        (Math.abs(c.curvature) > CORNER_CURVATURE ? corner : straight).push(c.speed);
      }
    }
    for (let i = 0; i < s.cars.length; i += 1) {
      for (let j = i + 1; j < s.cars.length; j += 1) {
        const d = Math.hypot(s.cars[i].x - s.cars[j].x, s.cars[i].z - s.cars[j].z);
        if (d < minSeparation) minSeparation = d;
      }
    }
    const active = s.cars.some((c) => !c.finished);
    if (s.time < 24 && active) {
      onScreenMinActive = Math.min(onScreenMinActive, s.onScreen);
      onScreenSum += s.onScreen;
      onScreenCount += 1;
    }
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const allFinished = samples[samples.length - 1].cars.every((c) => c.finished);
  const straightMean = mean(straight);
  const cornerMean = mean(corner);
  return {
    duration: samples[samples.length - 1].time,
    halfWidth,
    allFinished,
    finishTime,
    maxAbsOffset: Number(maxAbsOffset.toFixed(3)),
    offRoadSamples,
    minSeparation: Number(minSeparation.toFixed(3)),
    onScreenMinActive: Number(onScreenMinActive.toFixed(2)),
    onScreenMeanActive: Number((onScreenSum / Math.max(onScreenCount, 1)).toFixed(2)),
    straightMeanSpeed: Number(straightMean.toFixed(2)),
    cornerMeanSpeed: Number(cornerMean.toFixed(2)),
    brakesForCorners: cornerMean < straightMean,
  };
}

try {
  await mkdir(outDir, { recursive: true });
  const results = [];
  const problems = [];

  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => problems.push(`${stage} pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`${stage} console: ${m.text()}`);
    });

    await page.goto(`${origin}/?race=${stage}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.apexRace, null, { timeout: 15000 });

    // Record a snapshot every ~100 ms for the duration of the race.
    await page.evaluate(() => {
      window.__samples = [];
      window.__timer = setInterval(() => {
        const scene = window.apexRace?.scene;
        if (scene) window.__samples.push(scene.snapshot());
      }, 100);
    });

    const captured = new Set();
    const files = [];
    const deadline = Date.now() + 45000;
    for (;;) {
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => {
        const s = window.__samples[window.__samples.length - 1];
        return s ? { time: s.time, done: s.cars.every((c) => c.finished) } : null;
      });
      if (!state) continue;
      for (const t of FRAME_TIMES) {
        if (!captured.has(t) && state.time >= t) {
          captured.add(t);
          const file = join(outDir, `APEX-7-playtest-${stage}-t${t}.png`);
          await page.screenshot({ path: file });
          files.push(file);
        }
      }
      if (state.done || Date.now() > deadline) break;
    }

    const samples = await page.evaluate(() => {
      clearInterval(window.__timer);
      return window.__samples;
    });
    await page.close();

    const analysis = analyse(samples);
    const ok =
      analysis.allFinished &&
      analysis.offRoadSamples === 0 &&
      analysis.maxAbsOffset <= analysis.halfWidth + 1e-6 &&
      analysis.minSeparation > 2.0 &&
      analysis.brakesForCorners &&
      analysis.onScreenMeanActive >= 2;
    results.push({ stage, ok, frames: files, ...analysis });
  }

  const ok = problems.length === 0 && results.every((r) => r.ok);
  const report = { ok, origin, stages: results, problems };
  await writeFile(join(outDir, "APEX-7-playtest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
