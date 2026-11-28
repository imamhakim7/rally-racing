// Player playtest of every difficulty tier (#APEX-8): watches the *built*,
// visible CPU race in headless Chromium at `?race=<stage>&difficulty=<tier>` and
// measures what a player actually feels —
//   * does the pack stay within a bounded distance (spread never runs away)?
//   * are there any unnatural speed changes (teleport-like jumps)?
//   * does it stay on the road, hold separation, brake for corners, keep cars on screen?
//
//   bun run build && bun scripts/playtest-difficulty.mjs
//
// Output: docs/evidence/APEX-8-playtest.json + APEX-8-playtest-<stage>-<tier>-t<sec>.png.
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
const TIERS = ["easy", "normal", "hard", "rally-legend"];
const FRAME_TIMES = [1, 10, 20];
const CORNER_CURVATURE = 0.012;

// Player-facing bounds. The pack must stay close (bounded spread) and no car may
// change speed faster than the tyres allow (no teleport-like pop).
const MAX_PACK_SPREAD = 120; // m — the widest lead↔tail gap a "close" race may reach
const MAX_SPEED_STEP = 6; // m/s between ~100 ms samples (≈60 m/s², well above real g)

function analyse(samples) {
  const halfWidth = samples[0].roadHalfWidth;
  let maxAbsOffset = 0;
  let offRoadSamples = 0;
  let minSeparation = Infinity;
  let maxPackSpread = 0;
  let maxSpeedStep = 0;
  let onScreenMinActive = Infinity;
  let onScreenSum = 0;
  let onScreenCount = 0;
  const straight = [];
  const corner = [];
  const lastSpeed = new Map();
  const finishTime = {};

  for (const s of samples) {
    const racing = s.cars.filter((c) => !c.finished);
    for (const c of s.cars) {
      maxAbsOffset = Math.max(maxAbsOffset, Math.abs(c.centerOffset));
      if (Math.abs(c.centerOffset) > halfWidth + 1e-6) offRoadSamples += 1;
      if (c.finished && finishTime[c.id] === undefined) finishTime[c.id] = s.time;
      // Speed-change smoothness only applies while a car is racing: the finish
      // park legitimately stops a car in one frame, which is not a player-visible
      // pop mid-race. A finished car is not compared again.
      const prev = lastSpeed.get(c.id);
      if (!c.finished && prev !== undefined) {
        maxSpeedStep = Math.max(maxSpeedStep, Math.abs(c.speed - prev));
      }
      lastSpeed.set(c.id, c.finished ? undefined : c.speed);
      if (s.time > 3) (Math.abs(c.curvature) > CORNER_CURVATURE ? corner : straight).push(c.speed);
    }
    for (let i = 0; i < s.cars.length; i += 1) {
      for (let j = i + 1; j < s.cars.length; j += 1) {
        const d = Math.hypot(s.cars[i].x - s.cars[j].x, s.cars[i].z - s.cars[j].z);
        if (d < minSeparation) minSeparation = d;
      }
    }
    // Pack spread: the widest gap between any two cars still racing (or all once done).
    const group = racing.length > 1 ? racing : s.cars;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const d = Math.hypot(group[i].x - group[j].x, group[i].z - group[j].z);
        if (d > maxPackSpread) maxPackSpread = d;
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
  const times = Object.values(finishTime);
  const finishSpread = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const straightMean = mean(straight);
  const cornerMean = mean(corner);
  const boundedPack = maxPackSpread <= MAX_PACK_SPREAD;
  const smoothSpeed = maxSpeedStep <= MAX_SPEED_STEP;
  const ok =
    allFinished &&
    offRoadSamples === 0 &&
    maxAbsOffset <= halfWidth + 1e-6 &&
    minSeparation > 2.0 &&
    cornerMean < straightMean &&
    onScreenMinActive >= 1 &&
    boundedPack &&
    smoothSpeed;
  return {
    duration: samples[samples.length - 1].time,
    halfWidth,
    allFinished,
    finishTime,
    finishSpread: Number(finishSpread.toFixed(2)),
    maxAbsOffset: Number(maxAbsOffset.toFixed(3)),
    offRoadSamples,
    minSeparation: Number(minSeparation.toFixed(3)),
    maxPackSpread: Number(maxPackSpread.toFixed(2)),
    maxSpeedStep: Number(maxSpeedStep.toFixed(2)),
    onScreenMinActive: Number(onScreenMinActive.toFixed(2)),
    onScreenMeanActive: Number((onScreenSum / Math.max(onScreenCount, 1)).toFixed(2)),
    straightMeanSpeed: Number(straightMean.toFixed(2)),
    cornerMeanSpeed: Number(cornerMean.toFixed(2)),
    brakesForCorners: cornerMean < straightMean,
    boundedPack,
    smoothSpeed,
    ok,
  };
}

try {
  await mkdir(outDir, { recursive: true });
  const results = [];
  const problems = [];

  for (const stage of STAGES) {
    for (const tier of TIERS) {
      const label = `${stage}/${tier}`;
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`${label} console: ${m.text()}`);
      });

      await page.goto(`${origin}/?race=${stage}&difficulty=${tier}`, { waitUntil: "load" });
      await page.waitForFunction(() => !!window.apexRace, null, { timeout: 15000 });
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
            const file = join(outDir, `APEX-8-playtest-${stage}-${tier}-t${t}.png`);
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
      results.push({ stage, tier, frames: files, ...analysis });
      console.log(
        `${analysis.ok ? "PASS" : "FAIL"} ${label.padEnd(26)} dur=${analysis.duration.toFixed(1)} ` +
          `spread=${analysis.maxPackSpread} finishSpread=${analysis.finishSpread} ` +
          `maxSpeedStep=${analysis.maxSpeedStep} minSep=${analysis.minSeparation} ` +
          `off=${analysis.offRoadSamples} onScreen>=${analysis.onScreenMinActive} ` +
          `corner<straight=${analysis.brakesForCorners}`,
      );
    }
  }

  const ok = problems.length === 0 && results.every((r) => r.ok);
  const report = { ok, origin, bounds: { MAX_PACK_SPREAD, MAX_SPEED_STEP }, races: results, problems };
  await writeFile(join(outDir, "APEX-8-playtest.json"), JSON.stringify(report, null, 2));
  console.log(`\nALL OK: ${ok}`);
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
