// Headless difficulty/balance report for #APEX-8 evidence.
//
//   bun scripts/ai-difficulty-report.ts [--seeds=20]
//
// Runs the deterministic tiered race simulator on every shipped stage for each
// difficulty tier and writes docs/evidence/APEX-8-difficulty-report.json + .txt.
// Exits non-zero when a band is violated:
//   easy   reference-human win rate >= 0.80
//   hard   reference-human win rate <= 0.60   (a competent human can lose)
//   legend reference-human win rate <= 0.60
//   every  tier keeps off-surface == 0, maxStepDisplacement <= MAX_STEP_DISPLACEMENT,
//          maxSpeedDelta <= MAX_SPEED_DELTA, catch-up ratios inside the tier band,
//          and minSeparation > 2 m; corner speed strictly increases with the tier.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";
import {
  DIFFICULTY_TIERS,
  MAX_SPEED_DELTA,
  MAX_STEP_DISPLACEMENT,
  difficultyTuning,
  type DifficultyTier,
} from "../src/ai/difficulty";

const seedsArg = process.argv.find((a) => a.startsWith("--seeds="));
const SEEDS = seedsArg ? Math.max(1, Number(seedsArg.split("=")[1])) : 20;
const outDir = resolve(process.cwd(), "docs/evidence");
mkdirSync(outDir, { recursive: true });

const library = new StageLibrary();
const stages = library.list();

interface TierSummary {
  tier: DifficultyTier;
  races: number;
  referenceWins: number;
  referenceWinRate: number;
  cornerMeanSpeed: number;
  straightMeanSpeed: number;
  maxSpeedDelta: number;
  maxStepDisplacement: number;
  minSeparation: number;
  offSurfaceSamples: number;
  catchUpMinRatio: number;
  catchUpMaxRatio: number;
  cappedSteps: number;
  ok: boolean;
}

function summarise(tier: DifficultyTier): TierSummary {
  const tuning = difficultyTuning(tier);
  let races = 0;
  let referenceWins = 0;
  let cornerSum = 0;
  let straightSum = 0;
  let speedSamples = 0;
  let maxSpeedDelta = 0;
  let maxStepDisplacement = 0;
  let minSeparation = Infinity;
  let offSurfaceSamples = 0;
  let catchUpMinRatio = Infinity;
  let catchUpMaxRatio = 0;
  let cappedSteps = 0;

  for (const stage of stages) {
    const circuit = library.load(stage.id);
    for (let s = 0; s < SEEDS; s += 1) {
      const result = simulateRace(circuit, { seed: 5000 + s * 29, tier, player: {} });
      const reference = result.reference;
      const bestCpu = Math.min(
        ...result.cars.map((c) => (c.finishTime === null ? Infinity : c.finishTime)),
      );
      if (reference && reference.finishTime !== null && reference.finishTime < bestCpu) {
        referenceWins += 1;
      }
      races += 1;
      for (const car of result.cars) {
        cornerSum += car.cornerMeanSpeed;
        straightSum += car.straightMeanSpeed;
        speedSamples += 1;
        maxStepDisplacement = Math.max(maxStepDisplacement, car.maxStepDisplacement);
        offSurfaceSamples += car.offSurfaceSamples;
      }
      maxSpeedDelta = Math.max(maxSpeedDelta, result.maxSpeedDelta);
      minSeparation = Math.min(minSeparation, result.minSeparation);
      if (result.catchUp) {
        catchUpMinRatio = Math.min(catchUpMinRatio, result.catchUp.minRatio);
        catchUpMaxRatio = Math.max(catchUpMaxRatio, result.catchUp.maxRatio);
        cappedSteps += result.catchUp.cappedSteps;
      }
    }
  }

  const referenceWinRate = referenceWins / races;
  const ok =
    offSurfaceSamples === 0 &&
    minSeparation > 2.0 &&
    maxStepDisplacement <= MAX_STEP_DISPLACEMENT + 1e-9 &&
    maxSpeedDelta <= MAX_SPEED_DELTA + 1e-9 &&
    catchUpMinRatio >= 1 - tuning.catchUp.maxSlow - 1e-9 &&
    catchUpMaxRatio <= 1 + tuning.catchUp.maxBoost + 1e-9;

  return {
    tier,
    races,
    referenceWins,
    referenceWinRate: Number(referenceWinRate.toFixed(3)),
    cornerMeanSpeed: Number((cornerSum / speedSamples).toFixed(2)),
    straightMeanSpeed: Number((straightSum / speedSamples).toFixed(2)),
    maxSpeedDelta: Number(maxSpeedDelta.toFixed(2)),
    maxStepDisplacement: Number(maxStepDisplacement.toFixed(3)),
    minSeparation: Number(minSeparation.toFixed(3)),
    offSurfaceSamples,
    catchUpMinRatio: Number(catchUpMinRatio.toFixed(3)),
    catchUpMaxRatio: Number(catchUpMaxRatio.toFixed(3)),
    cappedSteps,
    ok,
  };
}

const tiers = DIFFICULTY_TIERS.map(summarise);
const byTier = new Map(tiers.map((t) => [t.tier, t] as const));

const easy = byTier.get("easy")!;
const hard = byTier.get("hard")!;
const legend = byTier.get("rally-legend")!;

const bands = {
  easyWins: easy.referenceWinRate >= 0.8,
  hardCanLose: hard.referenceWinRate <= 0.6,
  legendCanLose: legend.referenceWinRate <= 0.6,
  cornerOrdered: tiers.every(
    (t, i) => i === 0 || t.cornerMeanSpeed > tiers[i - 1]!.cornerMeanSpeed,
  ),
  telemetryBounded: tiers.every((t) => t.ok),
};
const allOk = Object.values(bands).every(Boolean) && tiers.every((t) => t.ok);

const report = { allOk, seeds: SEEDS, bands, tiers };
writeFileSync(
  resolve(outDir, "APEX-8-difficulty-report.json"),
  JSON.stringify(report, null, 2),
);

const lines = [
  `APEX-8 difficulty & fair catch-up report (${SEEDS} seeds × ${stages.length} stages × 4 tiers)`,
  "",
];
for (const t of tiers) {
  lines.push(
    `${t.ok ? "PASS" : "FAIL"} ${t.tier.padEnd(13)} refWin=${t.referenceWinRate} ` +
      `corner=${t.cornerMeanSpeed} straight=${t.straightMeanSpeed} ` +
      `maxΔv=${t.maxSpeedDelta} maxStep=${t.maxStepDisplacement} minSep=${t.minSeparation} ` +
      `off=${t.offSurfaceSamples} catchUp=[${t.catchUpMinRatio},${t.catchUpMaxRatio}] capped=${t.cappedSteps}`,
  );
}
lines.push(
  "",
  `bands: easyWins=${bands.easyWins} hardCanLose=${bands.hardCanLose} ` +
    `legendCanLose=${bands.legendCanLose} cornerOrdered=${bands.cornerOrdered} ` +
    `telemetryBounded=${bands.telemetryBounded}`,
  `ALL OK: ${allOk}`,
);
writeFileSync(resolve(outDir, "APEX-8-difficulty-report.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (!allOk) process.exitCode = 1;
