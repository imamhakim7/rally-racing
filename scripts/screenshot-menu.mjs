// Browser evidence for the menus, stage select, settings and tutorial (#APEX-11).
//
//   bun run build && bun scripts/screenshot-menu.mjs
//
// Boots the built app in headless Chromium (SwiftShader WebGL2) and drives the
// whole acceptance path with the real DOM:
//   - home -> Play -> select a card -> Race is exactly three actions (AC1);
//   - stage cards preview biome, sampled length and difficulty glyph+word (AC2);
//   - a settings change survives a page reload, read from localStorage (AC3);
//   - results offer Retry and Next stage, and Next advances the circuit (AC4);
//   - the tutorial gates each lesson on the player performing the action (AC5).
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

const waitForPhase = async (page, phase, timeout = 10_000) => {
  await page.waitForFunction(
    (wanted) => document.querySelector(".apex-hud")?.dataset.phase === wanted,
    phase,
    { timeout },
  );
};

const waitMenuHome = (page, timeout = 10_000) =>
  page.waitForFunction(
    () => {
      const menu = document.querySelector("#menu .apex-menu");
      return Boolean(menu && !menu.hidden && menu.dataset.screen === "home");
    },
    { timeout },
  );

const readState = (page) =>
  page.evaluate(() => {
    const api = window.apexStage;
    return {
      screen: api?.menu?.screen ?? null,
      selectedId: api?.menu?.selectedId ?? null,
      menuHidden: api?.menu ? api.menu.element.hidden : null,
      phase: api?.race?.session?.phase ?? null,
      currentStage: api?.scene?.current?.id ?? null,
      raceStageId: api?.race?.session?.controller?.stage?.id ?? null,
      raceGateCount: api?.race?.session?.controller?.stage?.checkpoints?.length ?? null,
      tutorialIndex: api?.tutorial ? api.tutorial.index : null,
      tutorialComplete: api?.tutorial ? api.tutorial.complete : null,
      settings: api?.settings ?? null,
    };
  });

const report = { ok: true, steps: [], problems: [] };
const record = (name, data) => {
  report.steps.push({ name, ...data });
  console.log(`[${name}] ${JSON.stringify(data)}`);
};
const fail = (message) => {
  report.ok = false;
  report.problems.push(message);
  console.error(`FAIL: ${message}`);
};

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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => fail(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") fail(`console: ${m.text()}`);
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.apexStage?.menu), { timeout: 15_000 });

  // ---- AC1 home screen ----------------------------------------------------
  const home = await readState(page);
  record("home", home);
  if (home.screen !== "home") fail(`expected home screen, got ${home.screen}`);
  await page.screenshot({ path: join(outDir, "APEX-11-home.png") });

  // ---- AC3 settings persist locally --------------------------------------
  await page.locator("#menu").getByRole("button", { name: "Settings" }).click();
  await page.locator("#apex-setting-volume").fill("25");
  await page.uncheck("#apex-setting-voice");
  await page.selectOption("#apex-setting-motion", "on");
  await page.waitForTimeout(100);
  const changed = await readState(page);
  record("settings-changed", { settings: changed.settings });
  await page.screenshot({ path: join(outDir, "APEX-11-settings.png") });
  if (changed.settings?.game?.volume !== 0.25) fail(`volume not saved: ${changed.settings?.game?.volume}`);
  if (changed.settings?.game?.voice !== false) fail("voice not saved");
  if (changed.settings?.accessibility?.reducedMotion !== "on") fail(`reducedMotion not saved: ${changed.settings?.accessibility?.reducedMotion}`);

  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.apexStage?.settings), { timeout: 15_000 });
  const reloaded = await readState(page);
  record("settings-reloaded", { settings: reloaded.settings });
  if (reloaded.settings?.game?.volume !== 0.25 || reloaded.settings?.game?.voice !== false) {
    fail(`settings did not persist across reload: ${JSON.stringify(reloaded.settings)}`);
  }
  if (!(await page.evaluate(() => document.documentElement.dataset.motion === "reduced"))) {
    fail("reduced-motion setting not applied to the document");
  }

  // ---- AC1 + AC2 three actions and stage cards ----------------------------
  await page.locator("#menu").getByRole("button", { name: "Play" }).click(); // action 1
  const cards = await page.evaluate(() => {
    const catalog = new Map((window.apexStage?.library?.list?.() ?? []).map((e) => [e.id, e]));
    return [...document.querySelectorAll(".apex-card")].map((card) => {
      const id = card.dataset.stageId;
      return {
        id,
        name: card.querySelector(".apex-card__name")?.textContent ?? "",
        meta: card.querySelector(".apex-card__meta")?.textContent ?? "",
        difficulty: card.querySelector(".apex-card__difficulty")?.textContent ?? "",
        biome: catalog.get(id)?.biome ?? null,
        lengthM: catalog.get(id)?.lengthM ?? null,
      };
    });
  });
  const selectState = await readState(page);
  record("stage-select", { screen: selectState.screen, cards: cards.length, sample: cards[0] });
  if (selectState.screen !== "stage_select") fail(`expected stage_select, got ${selectState.screen}`);
  if (cards.length < 6) fail(`expected >= 6 stage cards, got ${cards.length}`);
  for (const card of cards) {
    if (!card.id || !card.name) fail(`card missing id/name: ${JSON.stringify(card)}`);
    if (!card.biome || !card.meta.startsWith(card.biome)) {
      fail(`card meta missing biome "${card.biome}": ${card.meta}`);
    }
    if (!Number.isFinite(card.lengthM) || !/\d/.test(card.meta)) {
      fail(`card meta missing length: ${card.meta}`);
    }
    if (!/[★☆]/.test(card.difficulty) || !/[A-Za-z]/.test(card.difficulty)) {
      fail(`difficulty missing glyph+word: ${card.difficulty}`);
    }
  }
  await page.screenshot({ path: join(outDir, "APEX-11-stage-select.png") });

  const target = cards[0].id;
  await page.click(`.apex-card[data-stage-id="${target}"]`); // action 2
  const raceEnabled = await page.locator("#menu").getByRole("button", { name: "Race" }).isEnabled();
  record("stage-selected", { selectedId: target, raceEnabled });
  if (!raceEnabled) fail("Race button not enabled after selecting a card");

  await page.locator("#menu").getByRole("button", { name: "Race" }).click(); // action 3
  await waitForPhase(page, "countdown");
  const racing = await readState(page);
  record("race-started", racing);
  if (racing.menuHidden !== true) fail("menu should be hidden once the race starts");

  // ---- AC4 results Retry + Next stage ------------------------------------
  await waitForPhase(page, "racing", 10_000);
  await page.evaluate(() => {
    const api = window.apexStage;
    const session = api.race.session;
    const stage = session.controller.stage;
    for (const cp of stage.checkpoints) session.crossGate(cp.id);
    session.crossGate(stage.finishId);
  });
  await waitForPhase(page, "finished", 5_000);
  const resultsButtons = await page.evaluate(() =>
    [...document.querySelectorAll(".apex-results button")].map((b) => b.textContent),
  );
  record("results", { buttons: resultsButtons });
  if (!resultsButtons.includes("Restart")) fail("results missing Retry (Restart)");
  if (!resultsButtons.includes("Next stage")) fail("results missing Next stage");
  await page.screenshot({ path: join(outDir, "APEX-11-results.png") });

  const beforeNext = await readState(page);
  await page.getByRole("button", { name: "Next stage" }).click();
  await waitForPhase(page, "countdown", 5_000);
  await page.waitForTimeout(200);
  const afterNext = await readState(page);
  record("next-stage", {
    from: beforeNext.currentStage,
    to: afterNext.currentStage,
    raceStageId: afterNext.raceStageId,
    gateCount: afterNext.raceGateCount,
  });
  if (afterNext.currentStage === beforeNext.currentStage) {
    fail("Next stage did not advance the circuit");
  }
  if (afterNext.raceStageId !== afterNext.currentStage) {
    fail(`race definition did not follow the next stage (${afterNext.raceStageId})`);
  }

  // An invalidated run must still offer Retry + Next (AC4 edge).
  await waitForPhase(page, "racing", 10_000);
  await page.evaluate(() => {
    const session = window.apexStage.race.session;
    session.crossGate(session.controller.stage.finishId); // skip every checkpoint
  });
  await waitForPhase(page, "invalidated", 5_000);
  const invalidButtons = await page.evaluate(() =>
    [...document.querySelectorAll(".apex-results button")].map((b) => b.textContent),
  );
  record("results-invalidated", { buttons: invalidButtons });
  if (!invalidButtons.includes("Restart") || !invalidButtons.includes("Next stage")) {
    fail("invalidated results missing Retry/Next");
  }

  // ---- AC5 tutorial gating -----------------------------------------------
  await page.keyboard.press("q"); // quit back to the menu
  await waitMenuHome(page);
  // A held key is only observed when an engine frame runs between down and up,
  // so poll the tutorial index instead of sleeping a fixed time (deterministic
  // under SwiftShader, where a frame can exceed 200 ms).
  const waitTutorialIndex = (target, timeout = 8_000) =>
    page.waitForFunction(
      (wanted) => (window.apexStage?.tutorial?.index ?? -1) >= wanted,
      target,
      { timeout },
    );
  const firstRunVisible = await page.evaluate(
    () => !(document.querySelector(".apex-menu__first-run")?.hidden ?? true),
  );
  record("first-run-callout", { visible: firstRunVisible });
  if (!firstRunVisible) fail("first-run callout not shown on a fresh profile");

  await page.locator("#menu").getByRole("button", { name: "Tutorial" }).click();
  await page.waitForSelector('[data-testid="apex-tutorial"]:not([hidden])', { timeout: 5_000 });

  // Braking first must NOT advance the accelerate lesson.
  await page.keyboard.down("s");
  await page.waitForTimeout(300);
  await page.keyboard.up("s");
  await page.waitForTimeout(100);
  const afterBrake = (await readState(page)).tutorialIndex;
  record("tutorial-gate-negative", { indexAfterBrake: afterBrake });
  if (afterBrake !== 0) fail(`tutorial advanced without the gated action (index ${afterBrake})`);

  // Accelerate (keep W held to also build speed for the steering lesson).
  await page.keyboard.down("w");
  await waitTutorialIndex(1);
  // Brake.
  await page.keyboard.down("s");
  await waitTutorialIndex(2);
  await page.keyboard.up("s");
  // Handbrake.
  await page.keyboard.down("Space");
  await waitTutorialIndex(3);
  await page.keyboard.up("Space");
  await page.screenshot({ path: join(outDir, "APEX-11-tutorial.png") });
  // Steering only counts while moving — W is still held, so the car is rolling.
  await page.waitForTimeout(1200);
  await page.keyboard.down("a");
  await waitTutorialIndex(4);
  await page.keyboard.up("a");
  await page.keyboard.up("w");

  await page.waitForFunction(() => window.apexStage?.tutorial?.complete === true, { timeout: 6_000 });
  await waitMenuHome(page, 6_000);
  const tutorialDone = await readState(page);
  const firstRunAfter = await page.evaluate(
    () => !(document.querySelector(".apex-menu__first-run")?.hidden ?? false),
  );
  record("tutorial-complete", {
    index: tutorialDone.tutorialIndex,
    complete: tutorialDone.tutorialComplete,
    tutorialSeen: tutorialDone.settings?.game?.tutorialSeen,
    firstRunCalloutHidden: !firstRunAfter,
  });
  if (!tutorialDone.tutorialComplete) fail("tutorial did not complete after all four actions");
  if (tutorialDone.settings?.game?.tutorialSeen !== true) fail("tutorial completion not persisted");
  if (firstRunAfter) fail("first-run callout still shown after completing the tutorial");

  // The tutorial can be skipped at any time (AC5).
  await page.locator("#menu").getByRole("button", { name: "Tutorial" }).click();
  await page.waitForSelector('[data-testid="apex-tutorial"]:not([hidden])', { timeout: 5_000 });
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  const skipped = await page.evaluate(() => ({
    overlayHidden: document.querySelector('[data-testid="apex-tutorial"]')?.hidden ?? true,
    menuVisible: !(document.querySelector("#menu .apex-menu")?.hidden ?? true),
  }));
  record("tutorial-skip", skipped);
  if (!skipped.overlayHidden || !skipped.menuVisible) fail("skipping the tutorial did not return to the menu");

  await writeFile(join(outDir, "APEX-11-menu.json"), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  fail(`script error: ${error?.message ?? error}`);
} finally {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const text = [
    "# APEX-11 — browser menu evidence",
    "# bun run build && node scripts/screenshot-menu.mjs",
    "",
    ...report.steps.map((step) => `[${step.name}] ${JSON.stringify(step)}`),
    "",
    `verdict: ${report.ok ? "OK" : "FAILED"}`,
    ...report.problems.map((problem) => `FAIL: ${problem}`),
    "",
  ].join("\n");
  await writeFile(join(outDir, "APEX-11-menu.json"), json);
  await writeFile(join(outDir, "APEX-11-menu.txt"), text);
  await browser.close();
  server.close();
}

console.log(`\nAPEX-11 menu evidence: ${report.ok ? "OK" : "FAILED"}`);
if (!report.ok) {
  console.error(report.problems.join("\n"));
  process.exitCode = 1;
}
