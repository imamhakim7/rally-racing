// Browser/WebGL compatibility smoke (#APEX-14).
//
// Serves the production build and boots it in Chromium, Firefox and WebKit,
// asserting that every engine reaches exactly one *valid* outcome:
//   - "rendered": WebGL2 is available, the engine loop started and the support
//     state is exposed (data-support="supported"|"reduced"); or
//   - "fallback": WebGL2 is unavailable and the graceful unsupported-browser
//     screen is mounted (data-support="unsupported") with a missing-requirement
//     reason — never a thrown error or an unexplained black canvas.
//
// WebGL2 in headless Firefox needs a display, so run under Xvfb for a real
// render on all three engines:
//
//   bun run build && xvfb-run -a bun scripts/smoke-browsers.mjs
//
// Without a display, headless Firefox is expected to take the fallback branch
// (its WebGL2 is disabled), which is itself the behaviour under test.
//
// #APEX-26: this gate also boots the real bundle and asserts the entry-point
// wiring that unit tests never import — the stage select + HUD telemetry/minimap
// (#8) and the `?race=<stageId>` CPU scene — so a rebase that silently drops a
// side of src/main.ts fails CI instead of shipping.
//
// Output: docs/evidence/APEX-14-smoke.json, docs/evidence/APEX-14-smoke-*.png,
//         docs/evidence/APEX-14-fallback.png, docs/evidence/APEX-26-wiring.json
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const resultFile = join(outDir, "APEX-14-smoke.json");
const fallbackFile = join(outDir, "APEX-14-fallback.png");
const wiringFile = join(outDir, "APEX-26-wiring.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ktx2": "application/octet-stream",
  ".glb": "model/gltf-binary",
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // Browsers request /favicon.ico unprompted; answer it so a 404 console error
    // cannot mask (or fail) the gate. Real missing assets still 404 below.
    if (urlPath === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
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
const hasDisplay = Boolean(process.env.DISPLAY);

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];
const FIREFOX_PREFS = {
  "webgl.force-enabled": true,
  "webgl.disabled": false,
  "webgl.enable-webgl2": true,
  "webgl.software-rendering": true,
  "gfx.webrender.software": true,
  "gfx.webrender.all": true,
  "layers.acceleration.force-enabled": true,
};

function launchOptions(name) {
  // CHROME_BIN lets a local/CI environment reuse an already-installed Chromium
  // instead of Playwright's pinned download (handy offline).
  const chromiumPath = process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {};
  if (name === "chromium") return { headless: true, args: CHROMIUM_ARGS, ...chromiumPath };
  if (name === "firefox") {
    return {
      headless: !hasDisplay,
      firefoxUserPrefs: FIREFOX_PREFS,
      env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1", MOZ_WEBRENDER: "1" },
    };
  }
  return { headless: true };
}

// SMOKE_ENGINES=chromium keeps a quick local run to one engine; CI runs all.
const ALL_ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
const requestedEngines = (process.env.SMOKE_ENGINES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const engines = requestedEngines.length
  ? ALL_ENGINES.filter(([name]) => requestedEngines.includes(name))
  : ALL_ENGINES;

async function bootEngine(page, { forceUnsupported = false } = {}) {
  const url = forceUnsupported ? `${origin}/?forceUnsupported=1` : `${origin}/`;
  await page.goto(url, { waitUntil: "load" });
  // The supported path exposes window.apexStage synchronously; wait briefly.
  await page
    .waitForFunction(() => Boolean(window.apexStage), { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const canvas = document.getElementById("app");
    let webgl2 = false;
    try {
      webgl2 = Boolean(canvas?.getContext("webgl2"));
    } catch {
      webgl2 = false;
    }
    const fallbackEl = document.querySelector('.support-screen[data-support="unsupported"]');
    const api = window.apexStage;
    return {
      webgl2,
      bodySupport: document.body.getAttribute("data-support"),
      canvasSupport: canvas?.getAttribute("data-support") ?? null,
      fallback: Boolean(fallbackEl),
      fallbackMissing: fallbackEl?.getAttribute("data-missing") ?? null,
      fallbackText: fallbackEl?.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) ?? null,
      appRunning: Boolean(api?.app),
      level: api?.support?.level ?? null,
      preset: api?.quality?.id ?? null,
    };
  });

  let outcome;
  if (state.fallback) outcome = "fallback";
  else if (state.webgl2 && state.appRunning && state.level) outcome = "rendered";
  else outcome = "unknown";

  return { state, outcome };
}

/**
 * #APEX-26: the boot-wiring gate. A rebase once resolved src/main.ts with the
 * branch side, silently reverting the HUD telemetry/minimap (#8) and the
 * capability/support-screen wiring (#9/#APEX-14). typecheck, unit tests and the
 * build stayed green because no unit test imports the entry point. This boots
 * the real bundle and asserts both scenes are layered on the shared engine.
 */
async function checkWiring() {
  const browser = await chromium.launch(launchOptions("chromium"));
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
    });

    await page.goto(`${origin}/`, { waitUntil: "load" });
    await page
      .waitForFunction(() => Boolean(window.apexStage?.race), { timeout: 15_000 })
      .catch(() => {});
    const stage = await page.evaluate(() => {
      const api = window.apexStage;
      const select = document.querySelector("#stage-select select");
      return {
        support: api?.support?.level ?? null,
        quality: api?.quality?.id ?? null,
        scene: Boolean(api?.scene),
        app: Boolean(api?.app),
        race: Boolean(api?.race),
        hud: Boolean(api?.race?.hud),
        minimap: typeof api?.race?.hud?.setMinimap === "function",
        stageOptions: select ? select.options.length : 0,
        firstStage: select?.options?.[0]?.value ?? null,
      };
    });
    const stageOk =
      Boolean(stage.support) &&
      stage.scene &&
      stage.app &&
      stage.race &&
      stage.hud &&
      stage.minimap &&
      stage.stageOptions >= 6;
    if (!stageOk) problems.push(`stage wiring incomplete: ${JSON.stringify(stage)}`);

    const raceId = stage.firstStage ?? "alpine-forest";
    await page.goto(`${origin}/?race=${encodeURIComponent(raceId)}`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean(window.apexRace), { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const race = await page.evaluate(() => ({
      race: Boolean(window.apexRace),
      scene: Boolean(window.apexRace?.scene),
      app: Boolean(window.apexRace?.app),
      stageScene: Boolean(window.apexStage),
    }));
    const raceOk = race.race && race.scene && race.app && !race.stageScene;
    if (!raceOk) problems.push(`?race= wiring incomplete: ${JSON.stringify(race)}`);

    const report = { ok: stageOk && raceOk && problems.length === 0, raceId, stage, race, problems };
    await writeFile(wiringFile, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await browser.close();
  }
}

async function runEngine(name, type) {
  const browser = await type.launch(launchOptions(name));
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
    });

    const { state, outcome } = await bootEngine(page);
    if (outcome === "rendered") {
      await page.screenshot({ path: join(outDir, `APEX-14-smoke-${name}.png`) });
    }

    // Contract: a valid outcome, no uncaught errors, and never a fallback while
    // WebGL2 is actually available (that would be a detectable regression).
    const contradictoryFallback = outcome === "fallback" && state.webgl2;
    const ok = problems.length === 0 && outcome !== "unknown" && !contradictoryFallback;

    return { engine: name, outcome, ok, state, problems };
  } finally {
    await browser.close();
  }
}

await mkdir(outDir, { recursive: true });

const results = [];
try {
  for (const [name, type] of engines) {
    try {
      results.push(await runEngine(name, type));
    } catch (error) {
      results.push({
        engine: name,
        outcome: "launch-error",
        ok: false,
        state: null,
        problems: [String(error?.message ?? error)],
      });
    }
  }

  // Forced-unsupported profile screenshot (required evidence): the real screen
  // an unsupported browser sees, rendered in Chromium.
  let fallbackEvidence = { ok: false, path: fallbackFile, problems: [] };
  {
    const browser = await chromium.launch(launchOptions("chromium"));
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const problems = [];
      page.on("pageerror", (error) => problems.push(error.message));
      const { state, outcome } = await bootEngine(page, { forceUnsupported: true });
      await page.screenshot({ path: fallbackFile });
      fallbackEvidence = {
        ok: outcome === "fallback" && state.fallback && problems.length === 0,
        outcome,
        state,
        path: fallbackFile,
        problems,
      };
    } finally {
      await browser.close();
    }
  }

  const wiring = await checkWiring();

  const ok = results.every((r) => r.ok) && fallbackEvidence.ok && wiring.ok;
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    origin,
    hasDisplay,
    engines: results,
    forcedUnsupported: fallbackEvidence,
    wiring,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  server.close();
}
