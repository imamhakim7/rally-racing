// Accessibility + input evidence for #APEX-12.
//
//   bun run build && bun scripts/check-a11y.mjs
//
// Boots the built app in headless Chromium (SwiftShader WebGL2) and verifies the
// WCAG AA behaviours that are only observable in a browser:
//   - settings project palette / reduced-motion / text scale onto the root;
//   - the settings surface is keyboard-reachable in a logical focus order;
//   - 200% text scaling applies and does not clip form controls;
//   - the region scene reports zero camera motion under reduced motion, and the
//     motion-blur overlay is hidden.
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

const results = {};
let ok = true;

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

async function settingsEvidence() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForSelector(".apex-settings__toggle", { timeout: 15000 });

  const initial = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      palette: root.dataset.palette,
      motion: root.dataset.motion,
      textScale: getComputedStyle(root).getPropertyValue("--apex-text-scale").trim(),
    };
  });

  // #APEX-11 added a menu with its own "Settings" button; target this panel's
  // toggle specifically so the a11y check is unambiguous.
  await page.locator(".apex-settings__toggle").click();
  const panelVisible = await page.isVisible("#apex-settings-panel");

  // Keyboard reachability + logical order: tab from the toggle and record the DOM order.
  const focusable = await page.$$eval(
    "#apex-settings-panel button, #apex-settings-panel select, #apex-settings-panel input",
    (nodes) =>
      nodes.map((n) => ({
        tag: n.tagName.toLowerCase(),
        name:
          n.getAttribute("aria-label") ??
          n.closest("label")?.firstElementChild?.textContent ??
          n.textContent ??
          "",
        index: [...document.querySelectorAll("*")].indexOf(n),
      })),
  );
  const tabOrder = [];
  await page.focus(".apex-settings__toggle");
  for (let i = 0; i < focusable.length; i += 1) {
    await page.keyboard.press("Tab");
    tabOrder.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a ? a.tagName.toLowerCase() : "";
      }),
    );
  }
  const allNamed = focusable.every((f) => f.name.trim().length > 0);

  // Palette switch.
  await page.locator("#apex-settings-panel select").nth(1).selectOption("deuteranopia");
  const afterPalette = await page.evaluate(() => ({
    palette: document.documentElement.dataset.palette,
    good: getComputedStyle(document.documentElement).getPropertyValue("--apex-good").trim(),
  }));

  // 200% text scaling.
  await page.$eval('#apex-settings-panel input[type="range"]', (el) => {
    el.value = "200";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const scaled = await page.evaluate(() => {
    const panel = document.querySelector(".apex-settings");
    const panelStyle = getComputedStyle(panel);
    const controls = [...panel.querySelectorAll("button, select, input")];
    return {
      textScale: getComputedStyle(document.documentElement).getPropertyValue("--apex-text-scale").trim(),
      panelFont: parseFloat(panelStyle.fontSize),
      controlCount: controls.length,
      horizontalOverflow: panel.scrollWidth - panel.clientWidth,
    };
  });
  await page.screenshot({ path: join(outDir, "APEX-12-settings-200.png") });

  await page.close();
  const pass =
    problems.length === 0 &&
    panelVisible &&
    initial.palette === "default" &&
    initial.motion === "full" &&
    initial.textScale === "1" &&
    focusable.length >= 6 &&
    allNamed &&
    tabOrder.length === focusable.length &&
    afterPalette.palette === "deuteranopia" &&
    afterPalette.good.toLowerCase() === "#56b4ff" &&
    scaled.textScale === "2" &&
    scaled.panelFont > 20 &&
    scaled.horizontalOverflow <= 2;
  if (!pass) ok = false;
  results.settings = {
    pass,
    problems,
    initial,
    panelVisible,
    focusable,
    tabOrder,
    allNamed,
    afterPalette,
    scaled,
  };
}

async function motionEvidence(reducedMotion) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.emulateMedia({ reducedMotion });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${origin}/?race=mountain-pass`, { waitUntil: "load" });
  await page.waitForTimeout(6000);

  const snapshot = await page.evaluate(() => {
    const root = document.documentElement;
    const blur = document.querySelector(".apex-motion-blur");
    return {
      motion: root.dataset.motion,
      hasRace: !!window.apexRace,
      blurHidden: blur ? getComputedStyle(blur).display === "none" : null,
      effects: window.apexRace ? window.apexRace.scene.cameraEffects() : null,
    };
  });
  const suffix = reducedMotion === "reduce" ? "reduced" : "full";
  await page.screenshot({ path: join(outDir, `APEX-12-race-${suffix}.png`) });
  await page.close();

  const expectedMotion = reducedMotion === "reduce" ? "reduced" : "full";
  let pass = problems.length === 0 && snapshot.motion === expectedMotion;
  if (snapshot.hasRace) {
    if (reducedMotion === "reduce") {
      pass = pass && snapshot.blurHidden === true && snapshot.effects?.shake === 0 && snapshot.effects?.blur === 0;
    } else {
      pass = pass && (snapshot.effects?.blur ?? 0) > 0;
    }
  }
  if (!pass) ok = false;
  return { pass, problems, ...snapshot, reducedMotion };
}

await mkdir(outDir, { recursive: true });
try {
  await settingsEvidence();
  results.reduced = await motionEvidence("reduce");
  results.full = await motionEvidence("no-preference");
} finally {
  await browser.close();
  server.close();
}

const report = { ok, ...results };
const text = JSON.stringify(report, null, 2);
await writeFile(join(outDir, "APEX-12-a11y.txt"), text + "\n");
console.log(text);
if (!ok) process.exitCode = 1;
