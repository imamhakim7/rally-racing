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
// Output: docs/evidence/APEX-14-smoke.json, docs/evidence/APEX-14-smoke-*.png,
//         docs/evidence/APEX-14-fallback.png
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const resultFile = join(outDir, "APEX-14-smoke.json");
const fallbackFile = join(outDir, "APEX-14-fallback.png");

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
  if (name === "chromium") return { headless: true, args: CHROMIUM_ARGS };
  if (name === "firefox") {
    return {
      headless: !hasDisplay,
      firefoxUserPrefs: FIREFOX_PREFS,
      env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1", MOZ_WEBRENDER: "1" },
    };
  }
  return { headless: true };
}

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
  for (const [name, type] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
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
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
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

  const ok = results.every((r) => r.ok) && fallbackEvidence.ok;
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    origin,
    hasDisplay,
    engines: results,
    forcedUnsupported: fallbackEvidence,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  server.close();
}
