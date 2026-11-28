// Independent QA verification for #APEX-37 (HUD readouts honour the 200% text-size setting).
// Written by the QA seat; does NOT reuse the dev's scripts/qa-apex37-verify.mjs.
// Serves dist/, drives the real Settings UI, measures computed font-size of the
// prominent HUD readouts at 100/150/200%, and checks for clipping at 200%.
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve(process.cwd(), "dist");
const outDir = resolve(process.cwd(), "docs/evidence");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = normalize(join(distRoot, url === "/" ? "index.html" : url));
    if (file !== distRoot && !file.startsWith(distRoot + sep)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const SEL = {
  root: ".apex-hud",
  countdown: ".apex-countdown",
  time: ".apex-live .apex-time",
  speed: ".apex-speed .apex-speed-value",
  notes: ".apex-notes .apex-notes-call",
};

async function readFonts(page) {
  return page.evaluate((sel) => {
    const out = {};
    for (const [key, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) {
        out[key] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      out[key] = {
        font: parseFloat(cs.fontSize),
        textScaleVar: cs.getPropertyValue("--apex-text-scale").trim(),
        display: cs.display,
      };
    }
    return out;
  }, SEL);
}

async function measureViewport(browser, vp, targetScale) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: !!vp.touch,
    isMobile: !!vp.touch,
  });
  const page = await ctx.newPage();
  await page.goto(origin, { waitUntil: "load" });
  await page.waitForSelector(".apex-settings__toggle", { timeout: 20000 });

  // Drive the real #APEX-12 Settings panel (floating toggle), exactly as a user would.
  if (targetScale !== 1) {
    await page.locator(".apex-settings__toggle").click();
    const panel = page.locator("#apex-settings-panel");
    const slider = panel.locator('input[type="range"]');
    await slider.fill(String(targetScale * 100));
    await slider.dispatchEvent("input");
    await panel.getByRole("button", { name: "Close" }).click();
  }
  const appliedVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--apex-text-scale").trim(),
  );

  // #APEX-11 flow: Play -> pick a stage card -> Race. Capture the countdown
  // readout while its phase is live.
  const menu = page.locator('[data-testid="apex-menu"]');
  await menu.getByRole("button", { name: "Play" }).click();
  await menu.locator(".apex-card").first().click();
  await menu.getByRole("button", { name: "Race" }).click();
  await page
    .waitForFunction(() => window.apexStage?.race?.session?.phase === "countdown", null, {
      timeout: 20000,
    })
    .catch(() => {});
  const countdownFont = await page.evaluate(() => {
    const el = document.querySelector(".apex-countdown");
    return el ? { font: parseFloat(getComputedStyle(el).fontSize), display: getComputedStyle(el).display } : null;
  });

  await page.waitForFunction(() => window.apexStage?.race?.session?.phase === "racing", null, {
    timeout: 20000,
  });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  await page.keyboard.up("KeyW");

  const raceFonts = await readFonts(page);

  // "Clipped" = text is actually cut: a clipping ancestor (overflow hidden) hides
  // content, a single-line element truncates (scrollWidth > clientWidth), or the
  // text's own box leaves the viewport. A box whose scrollHeight slightly exceeds
  // clientHeight while `overflow: visible` is a cosmetic spill, not clipping, so it
  // is reported separately as a notice.
  const clip = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), top: Math.round(r.top) };
    };
    const clippingAncestor = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return n;
        n = n.parentElement;
      }
      return null;
    };
    const hard = [];
    const notices = [];
    for (const sel of [".apex-panel", ".apex-live", ".apex-speed", ".apex-notes"]) {
      for (const el of document.querySelectorAll(sel)) {
        const r = rect(el);
        const offscreen = r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || r.left < -1 || r.top < -1;
        const truncX = el.scrollWidth > el.clientWidth + 1;
        const clipAnc = clippingAncestor(el);
        const hiddenByAncestor = clipAnc
          ? el.scrollWidth > clipAnc.clientWidth + 1 || el.scrollHeight > clipAnc.clientHeight + 1
          : false;
        if (offscreen || truncX || hiddenByAncestor) {
          hard.push({ selector: sel, cls: el.className, offscreen, truncX, hiddenByAncestor, rect: r });
        } else if (el.scrollHeight > el.clientHeight + 1) {
          notices.push({ selector: sel, cls: el.className, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflow: getComputedStyle(el).overflow });
        }
      }
    }
    return {
      offenders: hard,
      notices,
      docOverX: document.documentElement.scrollWidth - window.innerWidth,
      docOverY: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

  if (targetScale === 2) {
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: join(outDir, `APEX-37-qa-${vp.name}-200pct.png`) });
  }
  await ctx.close();
  return {
    appliedVar: appliedVar === "" ? null : Number(appliedVar),
    countdown: countdownFont,
    race: Object.fromEntries(
      Object.entries(raceFonts).map(([k, v]) => [k, v === null ? null : { font: v.font, display: v.display }]),
    ),
    clip,
  };
}

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

const viewports = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "mobile", w: 390, h: 844, touch: true },
];
const scales = [1, 1.5, 2];
const results = {};
let pass = true;
const failures = [];

for (const vp of viewports) {
  results[vp.name] = {};
  for (const s of scales) {
    const m = await measureViewport(browser, vp, s);
    results[vp.name][`scale_${s}`] = m;
    if (m.appliedVar !== null && Math.abs(m.appliedVar - s) > 1e-6) {
      failures.push(`${vp.name}@${s}: --apex-text-scale=${m.appliedVar}`);
    }
    if (s === 1) continue;
    // Compare every readout against its own 100% baseline.
    const base = results[vp.name].scale_1;
    for (const key of ["root", "countdown", "time", "speed", "notes"]) {
      const b = key === "countdown" ? base.countdown?.font : base.race[key]?.font;
      const t = key === "countdown" ? m.countdown?.font : m.race[key]?.font;
      if (b == null || t == null) {
        failures.push(`${vp.name}@${s}: ${key} missing (base=${b}, target=${t})`);
        pass = false;
        continue;
      }
      const ratio = +(t / b).toFixed(3);
      m[`ratio_${key}`] = ratio;
      if (Math.abs(ratio - s) > 0.02) {
        failures.push(`${vp.name}@${s}: ${key} ratio ${ratio} != ${s} (base=${b}px, target=${t}px)`);
        pass = false;
      }
    }
  }
  // Clipping only matters at the maximum supported scale (200%).
  const max = results[vp.name].scale_2;
  if (max.clip.offenders.length || max.clip.docOverX > 1 || max.clip.docOverY > 1) {
    failures.push(`${vp.name}@200%: clipping detected ${JSON.stringify(max.clip)}`);
    pass = false;
  }
}

await browser.close();
server.close();

const report = { pass, failures, results };
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "APEX-37-qa-independent.json"), JSON.stringify(report, null, 2) + "\n");
const lines = [];
lines.push(`#APEX-37 independent QA verification — ${pass ? "PASS" : "FAIL"}`);
lines.push(`viewports=${viewports.map((v) => v.name).join(",")} scales=${scales.join(",")}`);
for (const [vp, byScale] of Object.entries(results)) {
  for (const [k, m] of Object.entries(byScale)) {
    const ratios = ["root", "countdown", "time", "speed", "notes"]
      .map((key) => `${key}=${m[`ratio_${key}`] ?? "-"}`)
      .join(" ");
    const notices = m.clip.notices.length ? ` notices=${m.clip.notices.length}(${m.clip.notices.map((n) => `${n.selector}:${n.overflow}y`).join(",")})` : "";
    lines.push(`${vp} ${k}: applied=${m.appliedVar} ${ratios} clipped=${m.clip.offenders.length} docOverX=${m.clip.docOverX} docOverY=${m.clip.docOverY}${notices}`);
  }
}
if (failures.length) lines.push(`FAILURES: ${failures.join(" | ")}`);
await writeFile(join(outDir, "APEX-37-qa-independent.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (!pass) process.exitCode = 1;
