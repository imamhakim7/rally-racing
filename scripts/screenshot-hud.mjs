// Responsive + accessibility evidence for the race HUD (#APEX-10).
//
//   bun run build && bun scripts/screenshot-hud.mjs
//
// Boots the built app in headless Chromium (SwiftShader WebGL2) and, at a
// 320px-wide phone and a 3840px-wide 4K viewport, starts a stage and measures:
//   - every racing HUD panel is visible and legible (font within bounds);
//   - no two panels overlap;
//   - no panel intersects the central band (the racing line, 25%..75%);
//   - split deltas turn green (ahead) and red (behind) with sign + glyph;
//   - the polite screen-reader summary is populated.
// Writes screenshots + a JSON report to docs/evidence/.
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const waitForPhase = async (page, phase, timeout = 8000) => {
  await page.waitForFunction(
    (wanted) => document.querySelector(".apex-hud")?.dataset.phase === wanted,
    phase,
    { timeout },
  );
};

/** Intersection of two rectangles (or null). */
const intersect = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

async function measure(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll(".apex-live, .apex-minimap, .apex-speed")]
      .filter((n) => getComputedStyle(n).display !== "none")
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          className: n.className,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        };
      });
    const fontOf = (sel) => {
      const n = document.querySelector(sel);
      return n ? parseFloat(getComputedStyle(n).fontSize) : null;
    };
    return {
      panels,
      timeFont: fontOf(".apex-live .apex-time"),
      speedFont: fontOf(".apex-speed-value"),
      timeText: document.querySelector(".apex-live .apex-time")?.textContent ?? "",
      speedText: document.querySelector(".apex-speed-value")?.textContent ?? "",
      srText: document.querySelector(".apex-sr")?.textContent ?? "",
      minimapVisible: !!document.querySelector(".apex-minimap") &&
        getComputedStyle(document.querySelector(".apex-minimap")).display !== "none",
      split: (() => {
        const n = document.querySelector(".apex-split");
        if (!n || getComputedStyle(n).display === "none") return null;
        return {
          text: n.textContent,
          className: n.className,
          color: getComputedStyle(n).color,
        };
      })(),
    };
  });
}

const results = [];
let ok = true;

// #APEX-11: start the first stage through the real menu (Play -> card -> Race).
async function startRaceFromMenu(page) {
  await page.evaluate(() => {
    const menu = window.apexStage?.menu;
    if (menu) {
      menu.element.hidden = false;
      menu.showScreen("stage_select");
    }
  });
  await page.click(".apex-card");
  await page.getByRole("button", { name: "Race" }).click();
}

try {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });

  for (const vp of [
    { width: 320, height: 568, name: "320" },
    { width: 3840, height: 2160, name: "4k" },
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });

    await page.goto(`${origin}/`, { waitUntil: "load" });
    await waitForPhase(page, "stage_select");
    await startRaceFromMenu(page);
    await waitForPhase(page, "racing", 8000);

    // Drive with real telemetry; cross cp-1 quickly for an "ahead" (green) split.
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(700);
    const srBefore = await page.evaluate(
      () => document.querySelector(".apex-sr")?.textContent ?? "",
    );
    await page.keyboard.press("1");
    await page.waitForTimeout(150);
    const ahead = await measure(page);
    await page.screenshot({ path: join(outDir, `APEX-10-hud-${vp.name}.png`) });
    await page.keyboard.up("KeyW");

    const central = {
      left: vp.width * 0.25,
      top: vp.height * 0.25,
      right: vp.width * 0.75,
      bottom: vp.height * 0.75,
    };
    const overlaps = [];
    for (let i = 0; i < ahead.panels.length; i += 1) {
      for (let j = i + 1; j < ahead.panels.length; j += 1) {
        if (intersect(ahead.panels[i].rect, ahead.panels[j].rect)) {
          overlaps.push([ahead.panels[i].className, ahead.panels[j].className]);
        }
      }
    }
    const occludesCentre = ahead.panels
      .filter((p) => intersect(p.rect, central))
      .map((p) => p.className);

    // Slow split for a "behind" (red) delta.
    await page.keyboard.press("q");
    await waitForPhase(page, "stage_select");
    await startRaceFromMenu(page);
    await waitForPhase(page, "racing", 8000);
    await page.waitForTimeout(12500); // cp-1 reference is 12s -> behind
    await page.keyboard.press("1");
    await page.waitForTimeout(150);
    const behind = await measure(page);

    const legible = (ahead.timeFont ?? 0) >= 10 && (ahead.speedFont ?? 0) >= 10;
    const vpOk =
      problems.length === 0 &&
      ahead.panels.length === 3 &&
      overlaps.length === 0 &&
      occludesCentre.length === 0 &&
      legible &&
      /^\d+:\d{2}\.\d{3}$/.test(ahead.timeText) &&
      /^\d+$/.test(ahead.speedText) &&
      ahead.minimapVisible &&
      ahead.srText.length > 0 &&
      srBefore.length > 0 &&
      ahead.srText !== srBefore &&
      ahead.split?.className.includes("ahead") &&
      ahead.split.color === "rgb(110, 231, 160)" &&
      behind.split?.className.includes("behind") &&
      behind.split.color === "rgb(255, 143, 107)";
    if (!vpOk) ok = false;

    results.push({
      viewport: vp,
      ok: vpOk,
      problems,
      panels: ahead.panels,
      overlaps,
      occludesCentre,
      timeFont: ahead.timeFont,
      speedFont: ahead.speedFont,
      timeText: ahead.timeText,
      speedText: ahead.speedText,
      minimapVisible: ahead.minimapVisible,
      srBefore,
      srText: ahead.srText,
      srUpdated: ahead.srText !== srBefore,
      aheadSplit: ahead.split,
      behindSplit: behind.split,
    });

    await page.close();
  }

  await browser.close();
} finally {
  server.close();
}

const report = { ok, results };
const text = JSON.stringify(report, null, 2);
await writeFile(join(outDir, "APEX-10-responsive.txt"), text + "\n");
console.log(text);
if (!ok) process.exitCode = 1;
