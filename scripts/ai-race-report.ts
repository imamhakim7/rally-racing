// Headless four-car race report for #APEX-7 evidence.
//
//   bun scripts/ai-race-report.ts
//
// Runs the deterministic race simulator on every shipped stage and writes
// docs/evidence/APEX-7-race-report.json + .txt. Exits non-zero if any stage
// fails the acceptance contract (all finish, on-surface, separated, in-window).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";

const library = new StageLibrary();
const outDir = resolve(process.cwd(), "docs/evidence");
mkdirSync(outDir, { recursive: true });

const report = [];
let allOk = true;

for (const entry of library.list()) {
  const circuit = library.load(entry.id);
  const result = simulateRace(circuit, { seed: 1 });
  const ok =
    result.complete &&
    result.cars.every(
      (c) =>
        c.offSurfaceSamples === 0 &&
        c.cornerMeanSpeed < c.straightMeanSpeed &&
        c.finishTime !== null &&
        c.finishTime >= result.window[0] &&
        c.finishTime <= result.window[1],
    ) &&
    result.minSeparation > 2.0;
  allOk = allOk && ok;
  report.push({
    stage: entry.id,
    ok,
    referenceTime: Number(result.referenceTime.toFixed(2)),
    window: result.window.map((v) => Number(v.toFixed(2))),
    minSeparation: Number(result.minSeparation.toFixed(3)),
    finishOrder: result.finishOrder,
    cars: result.cars.map((c) => ({
      id: c.id,
      skill: Number(c.skill.toFixed(3)),
      finishTime: c.finishTime === null ? null : Number(c.finishTime.toFixed(2)),
      offSurfaceSamples: c.offSurfaceSamples,
      maxCrossTrack: Number(c.maxCrossTrack.toFixed(3)),
      straightMeanSpeed: Number(c.straightMeanSpeed.toFixed(2)),
      cornerMeanSpeed: Number(c.cornerMeanSpeed.toFixed(2)),
      progress: Number(c.progress.toFixed(4)),
    })),
  });
}

writeFileSync(
  resolve(outDir, "APEX-7-race-report.json"),
  JSON.stringify({ allOk, stages: report }, null, 2),
);

const lines = ["APEX-7 headless four-car race report (seed 1)", ""];
for (const r of report) {
  lines.push(
    `${r.ok ? "PASS" : "FAIL"} ${r.stage}: ref=${r.referenceTime}s window=[${r.window[0]},${r.window[1]}] minSep=${r.minSeparation} order=${r.finishOrder.join(">")}`,
  );
  for (const c of r.cars) {
    lines.push(
      `    ${c.id} skill=${c.skill} finish=${c.finishTime}s off=${c.offSurfaceSamples} maxX=${c.maxCrossTrack} straight=${c.straightMeanSpeed} corner=${c.cornerMeanSpeed}`,
    );
  }
}
lines.push("", `ALL OK: ${allOk}`);
writeFileSync(resolve(outDir, "APEX-7-race-report.txt"), lines.join("\n") + "\n");

console.log(lines.join("\n"));
if (!allOk) process.exitCode = 1;
