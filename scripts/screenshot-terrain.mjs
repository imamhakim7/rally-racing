// APEX-28 browser evidence: terrain foundation.
//
// Loads every shipped stage through the visible race (`?race=<id>`), reads the
// resolved terrain (stats, biome palette, containment) from `window.apexRace`,
// proves per-seed determinism across two loads, and captures two screenshots.
//
//   bun run build && bun scripts/screenshot-terrain.mjs
//
// Output: docs/evidence/APEX-28-terrain.json, APEX-28-terrain-<id>.png.
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const SHOT_STAGES = ["alpine-forest", "desert-dunes"];

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

const readTerrain = (stageId) => async (page) => {
  return page.evaluate((id) => {
    const api = window.apexRace;
    if (!api) return { id, error: "no apexRace" };
    const world = api.scene.world;
    const position = world.terrain.mesh.geometry.getAttribute("position");
    let signature = 0x811c9dc5;
    for (let i = 0; i < position.count; i += 1) {
      const value = (Math.round(position.getY(i) * 1000) + Math.round(position.getX(i) * 10)) | 0;
      signature ^= value;
      signature = Math.imul(signature, 0x01000193);
    }
    const snapshot = api.scene.snapshot();
    const offCorridor = world.containment.resolve(1e4, 1e4, 0);
    return {
      id,
      stats: world.terrain.stats,
      surface: world.terrain.surface,
      ground: world.terrain.appearance.ground,
      ridge: world.terrain.appearance.ridge,
      halfWidth: world.containment.halfWidth,
      signature: signature >>> 0,
      carCount: snapshot.cars.length,
      onRoad: snapshot.cars.every((car) => Math.abs(car.centerOffset) <= snapshot.roadHalfWidth + 0.5),
      containment: { contained: offCorridor.contained, limit: offCorridor.limit },
    };
  }, stageId);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  const stages = [];
  for (const id of SHOT_STAGES.concat(["coastal-cliffs", "mountain-pass", "valley-rally", "canyon-sprint"])) {
    await page.goto(`${origin}/?race=${id}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.apexRace, null, { timeout: 15000 });
    await page.waitForTimeout(900);
    stages.push(await readTerrain(id)(page));
    if (SHOT_STAGES.includes(id)) {
      await page.screenshot({ path: join(outDir, `APEX-28-terrain-${id}.png`) });
    }
  }

  // Determinism: the same stage twice must produce the same heightfield.
  const first = stages.find((s) => s.id === "alpine-forest");
  await page.goto(`${origin}/?race=alpine-forest`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.apexRace, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const reloaded = await readTerrain("alpine-forest")(page);

  const signatures = new Set(stages.map((s) => s.signature));
  const ok =
    problems.length === 0 &&
    stages.length === 6 &&
    stages.every((s) => s.stats && s.stats.triangles > 0 && s.stats.drawCalls <= 4) &&
    signatures.size === 6 &&
    reloaded.signature === first.signature &&
    stages.every((s) => s.containment?.contained === true) &&
    stages.every((s) => s.onRoad === true);

  await mkdir(outDir, { recursive: true });
  const report = {
    ok,
    origin,
    stages,
    determinism: { stage: "alpine-forest", first: first.signature, reloaded: reloaded.signature },
    problems,
  };
  await writeFile(join(outDir, "APEX-28-terrain.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
