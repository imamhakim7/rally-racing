// Renders the built app in headless Chromium and verifies the co-driver
// pace-note HUD (#APEX-18): the panel surfaces the next corner ahead of the car,
// advances as the car covers ground, and the voice toggle is present.
//
//   bun run build && bun scripts/screenshot-pace-notes.mjs
//
// Output: docs/evidence/APEX-18-pace-notes.png + APEX-18-browser.txt
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  // Start the stage through the real menu (#APEX-11) and wait out the countdown.
  await page.evaluate(() => {
    const menu = window.apexStage?.menu;
    if (menu) {
      menu.element.hidden = false;
      menu.showScreen("stage_select");
    }
  });
  await page.click(".apex-card");
  await page.getByRole("button", { name: "Race" }).click();
  await page.waitForSelector('.apex-hud[data-phase="racing"]', { timeout: 15_000 });

  // Surface the notes deterministically for the capture (long lead, all notes).
  const setup = await page.evaluate(() => {
    const tracker = window.apexStage?.pace?.tracker;
    if (!tracker) return null;
    tracker.setLeadDistance(5000);
    tracker.setDensity(1);
    tracker.setDistance(0);
    return { noteCount: tracker.notes.length, first: tracker.notes[0]?.call ?? null };
  });
  await page.waitForTimeout(300);

  const first = await page.evaluate(() => {
    const panel = document.querySelector(".apex-notes");
    const visible = panel && !panel.classList.contains("apex-hide");
    return {
      visible: !!visible,
      call: document.querySelector(".apex-notes-call")?.textContent ?? null,
      distance: document.querySelector(".apex-notes-distance")?.textContent ?? null,
      following: document.querySelector(".apex-notes-following")?.textContent ?? null,
      voiceButton: (() => {
        const button = document.querySelector(".apex-notes-voice");
        if (!button || button.classList.contains("apex-hide")) return null;
        return { label: button.textContent, pressed: button.getAttribute("aria-pressed") };
      })(),
      notes: window.apexStage?.pace?.tracker?.notes.map((note) => note.call) ?? [],
    };
  });

  await mkdir(outDir, { recursive: true });
  const screenshot = join(outDir, "APEX-18-pace-notes.png");
  await page.screenshot({ path: screenshot });

  // Drive the tracker past the first corner and confirm the call advances. Read
  // the scheduler synchronously: the live harness re-projects the car distance
  // every frame, so a DOM read would race that.
  const advanced = await page.evaluate(() => {
    const tracker = window.apexStage?.pace?.tracker;
    if (!tracker || tracker.notes.length < 2) return null;
    tracker.setDistance(tracker.notes[0].distance + 1);
    const view = tracker.view();
    tracker.setDistance(0);
    return { nextCall: view.next?.call ?? null, nextText: view.nextText, current: view.current?.call ?? null };
  });

  const ok =
    problems.length === 0 &&
    setup !== null &&
    setup.noteCount > 0 &&
    first.visible &&
    typeof first.call === "string" &&
    first.call.length > 0 &&
    /^\d+ m$/.test(first.distance ?? "") &&
    advanced !== null &&
    advanced.nextCall !== null &&
    advanced.nextCall !== first.call &&
    advanced.current === first.call;

  const report = { ok, origin, screenshot, setup, first, advanced, problems };
  await writeFile(join(outDir, "APEX-18-browser.txt"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
