// Drives the built app in headless Chromium (SwiftShader WebGL2) through a full
// stage and captures evidence screenshots:
//   stage select -> countdown -> a run that deliberately skips checkpoint 1
//   (penalty) -> results -> restart -> quit back to stage select.
//
//   bun run build && bun scripts/screenshot-race.mjs
//
// Output: docs/evidence/APEX-3-{stage-select,countdown,results,restart}.png
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, normalize, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const shots = {
  select: join(outDir, "APEX-3-stage-select.png"),
  countdown: join(outDir, "APEX-3-countdown.png"),
  results: join(outDir, "APEX-3-results.png"),
  restart: join(outDir, "APEX-3-restart.png"),
};

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

/** "M:SS.mmm" -> seconds. */
function parseTime(text) {
  const m = /^(\d+):(\d{2})\.(\d{3})$/.exec((text ?? "").trim().replace(/^\+/, ""));
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
}

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

const phaseOf = (page) => page.evaluate(() => document.querySelector(".apex-hud")?.dataset.phase ?? null);
const waitForPhase = async (page, phase, timeout = 8000) => {
  await page.waitForFunction(
    (wanted) => document.querySelector(".apex-hud")?.dataset.phase === wanted,
    phase,
    { timeout },
  );
};

try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  await waitForPhase(page, "stage_select");
  // #APEX-11: the menu owns stage selection; show it and capture the select screen.
  await page.evaluate(() => {
    const menu = window.apexStage?.menu;
    if (menu) {
      menu.element.hidden = false;
      menu.showScreen("stage_select");
    }
  });
  await page.screenshot({ path: shots.select });

  // Start the stage: select a card, then Race -> countdown gates input.
  await page.click(".apex-card");
  await page.getByRole("button", { name: "Race" }).click();
  await waitForPhase(page, "countdown");
  await page.waitForTimeout(600); // show a countdown digit
  await page.screenshot({ path: shots.countdown });

  // Input during the countdown must be ignored.
  await page.keyboard.press("1");
  const ignoredDuringCountdown =
    (await page.evaluate(
      () => document.querySelector(".apex-hud")?.dataset.phase,
    )) === "countdown";

  await waitForPhase(page, "racing", 6000);

  // Deliberately skip checkpoint 1: cross cp-2 (key "2") first, then cp-3 ("3"),
  // then the finish ("F"). Small waits give visible splits.
  await page.keyboard.press("2");
  await page.waitForTimeout(600);
  await page.keyboard.press("3");
  await page.waitForTimeout(600);
  await page.keyboard.press("f");
  await waitForPhase(page, "finished", 4000);
  await page.screenshot({ path: shots.results });

  const report = await page.evaluate(() => {
    const pos = document.querySelector(".apex-pos")?.textContent ?? "";
    const rows = [...document.querySelectorAll(".apex-results tbody tr")].map((tr) =>
      [...tr.children].map((td) => td.textContent ?? ""),
    );
    return { pos, rows };
  });

  const splitRows = report.rows.filter(([gate]) => gate.startsWith("cp-") || gate === "Finish");
  const penaltyRow = report.rows.find(([gate]) => gate.startsWith("Penalties"));
  const totalRow = report.rows.find(([gate]) => gate === "Total");
  const splitSum = splitRows.reduce((acc, [, split]) => acc + parseTime(split), 0);
  const penalty = penaltyRow ? parseTime(penaltyRow[1]) : 0;
  const total = totalRow ? parseTime(totalRow[2] ?? totalRow[1]) : Number.NaN;
  const totalMatchesSplits =
    Number.isFinite(total) && Math.abs(total - (splitSum + penalty)) < 0.002;

  // Restart must reset cleanly (countdown), then quit returns to stage select.
  await page.keyboard.press("r");
  await waitForPhase(page, "countdown", 4000);
  await page.screenshot({ path: shots.restart });
  const restartedElapsed = await page.evaluate(
    () => document.querySelector(".apex-live .apex-time")?.textContent ?? "",
  );

  await page.keyboard.press("q");
  await waitForPhase(page, "stage_select", 4000);
  const backAtSelect = (await phaseOf(page)) === "stage_select";

  const diagnostic = {
    ok:
      problems.length === 0 &&
      ignoredDuringCountdown &&
      totalMatchesSplits &&
      backAtSelect &&
      /P\d+/.test(report.pos),
    ignoredDuringCountdown,
    position: report.pos,
    splitSum,
    penalty,
    total,
    totalMatchesSplits,
    restartedElapsed,
    backAtSelect,
    problems,
  };
  console.log(JSON.stringify(diagnostic, null, 2));
  if (!diagnostic.ok) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
