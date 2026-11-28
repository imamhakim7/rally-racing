// Deterministic headless race harness gate (#APEX-9).
//
//   bun scripts/headless-race.ts [--stage=<id>] [--seeds=1,7,42] [--out=<prefix>]
//
// Runs seeded races on every shipped stage, twice each, and asserts the two runs
// are identical (same finish order, finish times and trace hash) AND that the
// #APEX-7 contract still holds (all cars finish, on-surface, separated, in the
// per-stage window). Writes docs/evidence/APEX-9-determinism.{json,txt} and exits
// non-zero on any divergence or contract failure.
//
// No GPU, no network, no wall clock — this is the CI job's whole world.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { StageLibrary } from "../src/stage/library";
import { runHeadlessRace, type HeadlessRace } from "../src/ai/harness";
import { serializeTrace, traceHash } from "../src/ai/replay";
import { parseTrace, tracesEqual } from "../src/ai/trace";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const outPrefix = resolve(process.cwd(), arg("out") ?? "docs/evidence/APEX-9-determinism");
const seedList = (arg("seeds") ?? "1,7,42")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n));
const onlyStage = arg("stage");

const library = new StageLibrary();
const stages = library.list().filter((s) => !onlyStage || s.id === onlyStage);
if (stages.length === 0) {
  console.error(`no stages match --stage=${onlyStage}`);
  process.exit(1);
}

interface StageReport {
  stage: string;
  seed: number;
  ok: boolean;
  deterministic: boolean;
  hashA: string;
  hashB: string;
  roundTrip: boolean;
  finishOrder: string[];
  referenceTime: number;
  window: [number, number];
  minSeparation: number;
  cars: {
    id: string;
    skill: number;
    finishTime: number | null;
    offSurfaceSamples: number;
    maxCrossTrack: number;
    splits: string[];
  }[];
  failure?: string;
}

/** The #APEX-7 contract, re-asserted through the harness. */
function contractOk(run: HeadlessRace): string | undefined {
  const { result } = run;
  if (!result.complete) return "race did not complete";
  for (const car of result.cars) {
    if (car.finishTime === null) return `${car.id} did not finish`;
    if (car.offSurfaceSamples !== 0) return `${car.id} off-surface ${car.offSurfaceSamples}x`;
    if (car.cornerMeanSpeed >= car.straightMeanSpeed) return `${car.id} corner speed >= straight`;
    if (car.finishTime < result.window[0] || car.finishTime > result.window[1]) {
      return `${car.id} finish ${car.finishTime.toFixed(2)} outside [${result.window[0].toFixed(1)},${result.window[1].toFixed(1)}]`;
    }
  }
  if (!(result.minSeparation > 2.0)) return `min separation ${result.minSeparation.toFixed(3)} <= 2.0`;
  if (run.trace.finishOrder.join(">") !== result.finishOrder.join(">")) {
    return "trace finish order disagrees with result";
  }
  return undefined;
}

const report: StageReport[] = [];
let allOk = true;

for (const stage of stages) {
  const circuit = library.load(stage.id);
  for (const seed of seedList) {
    const a = runHeadlessRace(circuit, { seed });
    const b = runHeadlessRace(circuit, { seed });
    const deterministic = a.hash === b.hash && tracesEqual(a.trace, b.trace);

    const parsed = parseTrace(serializeTrace(a.trace));
    const roundTrip = traceHash(parsed) === a.hash && tracesEqual(parsed, a.trace);

    const contractFailure = contractOk(a);
    const ok = deterministic && roundTrip && !contractFailure;
    allOk = allOk && ok;

    report.push({
      stage: stage.id,
      seed,
      ok,
      deterministic,
      hashA: a.hash,
      hashB: b.hash,
      roundTrip,
      finishOrder: a.result.finishOrder,
      referenceTime: Number(a.result.referenceTime.toFixed(3)),
      window: [Number(a.result.window[0].toFixed(3)), Number(a.result.window[1].toFixed(3))],
      minSeparation: Number(a.result.minSeparation.toFixed(4)),
      cars: a.result.cars.map((c) => ({
        id: c.id,
        skill: Number(c.skill.toFixed(4)),
        finishTime: c.finishTime === null ? null : Number(c.finishTime.toFixed(4)),
        offSurfaceSamples: c.offSurfaceSamples,
        maxCrossTrack: Number(c.maxCrossTrack.toFixed(4)),
        splits: (a.splitTable[c.id] ?? []).map(
          (s) => `${s.checkpointId}@${s.progressT.toFixed(3)}=${s.time.toFixed(3)}`,
        ),
      })),
      failure: contractFailure,
    });
  }
}

mkdirSync(dirname(outPrefix), { recursive: true });
writeFileSync(`${outPrefix}.json`, JSON.stringify({ allOk, runs: report }, null, 2));

const lines = [
  "APEX-9 deterministic headless harness report",
  `seeds: ${seedList.join(",")}  stages: ${stages.length}`,
  "",
];
for (const r of report) {
  lines.push(
    `${r.ok ? "PASS" : "FAIL"} ${r.stage} seed=${r.seed} det=${r.deterministic} roundtrip=${r.roundTrip} hash=${r.hashA.slice(0, 12)}… order=${r.finishOrder.join(">")}${r.failure ? `  (${r.failure})` : ""}`,
  );
  for (const c of r.cars) {
    lines.push(
      `    ${c.id} skill=${c.skill} finish=${c.finishTime} off=${c.offSurfaceSamples} maxX=${c.maxCrossTrack} splits=[${c.splits.join(", ")}]`,
    );
  }
}
lines.push("", `ALL OK: ${allOk}`, `VERDICT: ${allOk ? "PASS" : "FAIL"}`);
writeFileSync(`${outPrefix}.txt`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (!allOk) process.exitCode = 1;
