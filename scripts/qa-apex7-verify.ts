// #APEX-7 how-to-test, hardened into a release gate (#APEX-27, #APEX-31).
//
//   bun scripts/qa-apex7-verify.ts                    # every stage, seeds [0, 10000)
//   bun scripts/qa-apex7-verify.ts --seeds=500        # quick check
//   bun scripts/qa-apex7-verify.ts --stage=mountain-pass --seeds=2000
//   bun scripts/qa-apex7-verify.ts --strict           # also fail on AC3 separation
//
// Runs the headless four-car race on every shipped stage over a seed *range*
// (not a handful of hand-picked seeds — the original #APEX-27 fix passed its
// own 8-seed test and still leaked on `coastal-cliffs` seed 6186) and checks:
//
//   AC1 containment     offSurfaceSamples == 0 and maxCrossTrack <= halfWidth
//   AC2 corner braking  cornerMeanSpeed < straightMeanSpeed
//   AC4 finish window   window[0] <= finishTime <= window[1]
//
// AC3 (min pairwise centre distance > 2.0 m) is measured and reported but is a
// *known pre-existing gap* on main: ~1.4 % of races bring two cars inside 2.0 m
// through a bend, before and after #APEX-27 (tracked separately; `--strict`
// fails on it so the full #APEX-7 contract can be gated once it is fixed).
//
// Prints one line per stage plus a per-AC summary and `VERDICT: PASS|FAIL`.
// Exits non-zero on FAIL so CI/a reviewer can gate on it.
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";

interface StageTotals {
  stage: string;
  races: number;
  leaks: number;
  windows: number;
  corner: number;
  separation: number;
  worstCross: number;
  worstCrossAt: string;
  minSeparation: number;
  minSeparationAt: string;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const seedCount = Math.max(1, Number(arg("seeds", "10000")) || 10_000);
const onlyStage = arg("stage", "");
const strict = process.argv.includes("--strict");

const library = new StageLibrary();
const stageIds = library
  .list()
  .map((s) => s.id)
  .filter((id) => !onlyStage || id === onlyStage);

if (stageIds.length === 0) {
  console.error(`no such stage: ${onlyStage}`);
  process.exit(2);
}

const totals = new Map<string, StageTotals>();
for (const id of stageIds) {
  totals.set(id, {
    stage: id,
    races: 0,
    leaks: 0,
    windows: 0,
    corner: 0,
    separation: 0,
    worstCross: 0,
    worstCrossAt: "",
    minSeparation: Infinity,
    minSeparationAt: "",
  });
}

const started = Date.now();
for (const id of stageIds) {
  const circuit = library.load(id);
  const halfWidth = circuit.road.width / 2;
  const acc = totals.get(id)!;
  for (let seed = 0; seed < seedCount; seed += 1) {
    const result = simulateRace(circuit, { seed });
    acc.races += 1;
    for (const car of result.cars) {
      if (car.maxCrossTrack > acc.worstCross) {
        acc.worstCross = car.maxCrossTrack;
        acc.worstCrossAt = `seed ${seed} ${car.id}`;
      }
      if (car.offSurfaceSamples > 0 || car.maxCrossTrack > halfWidth + 1e-6) acc.leaks += 1;
      if (car.cornerMeanSpeed >= car.straightMeanSpeed) acc.corner += 1;
      if (
        car.finishTime === null ||
        car.finishTime < result.window[0] ||
        car.finishTime > result.window[1]
      ) {
        acc.windows += 1;
      }
    }
    if (result.minSeparation < acc.minSeparation) {
      acc.minSeparation = result.minSeparation;
      acc.minSeparationAt = `seed ${seed}`;
    }
    if (result.minSeparation <= 2.0) acc.separation += 1;
    if ((seed + 1) % 2000 === 0 && seed + 1 < seedCount) {
      console.log(`${id}: ${seed + 1}/${seedCount} races…`);
    }
  }
}

const rows = [...totals.values()];
const sum = (pick: (t: StageTotals) => number) => rows.reduce((n, t) => n + pick(t), 0);
const leaks = sum((t) => t.leaks);
const windows = sum((t) => t.windows);
const corner = sum((t) => t.corner);
const separation = sum((t) => t.separation);

const lines: string[] = [];
lines.push(
  `#APEX-7 headless race verification — ${stageIds.length} stage(s) × seeds [0, ${seedCount}) ` +
    `= ${sum((t) => t.races) * 4} car-races`,
  "",
);
for (const t of rows) {
  const ok = t.leaks === 0 && t.windows === 0 && t.corner === 0;
  lines.push(
    `${ok ? "PASS" : "FAIL"} ${t.stage}: leaks=${t.leaks} window=${t.windows} cornerSpeed=${t.corner} ` +
      `worstCross=${t.worstCross.toFixed(4)} (${t.worstCrossAt}) ` +
      `minSep=${t.minSeparation.toFixed(3)} (${t.minSeparationAt})`,
  );
}
lines.push("");
lines.push(`AC1 containment (no off-surface, maxCrossTrack <= halfWidth): ${leaks === 0 ? "PASS" : `FAIL (${leaks})`}`);
lines.push(`AC2 corner speed below straight speed: ${corner === 0 ? "PASS" : `FAIL (${corner})`}`);
lines.push(
  `AC3 separation (min centre distance > 2.0 m): ` +
    (separation === 0
      ? "PASS"
      : `KNOWN GAP (${separation} race(s); pre-existing on main, tracked separately)`),
);
lines.push(`AC4 finish inside the per-stage window: ${windows === 0 ? "PASS" : `FAIL (${windows})`}`);
lines.push("");
const failed = leaks > 0 || windows > 0 || corner > 0 || (strict && separation > 0);
lines.push(`VERDICT: ${failed ? "FAIL" : "PASS"}`);
lines.push(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);

console.log(lines.join("\n"));
if (failed) process.exitCode = 1;
