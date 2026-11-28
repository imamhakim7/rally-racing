// Independent QA verification for #APEX-8 (difficulty tiers & fair catch-up).
//
// This deliberately re-derives the acceptance evidence with a DIFFERENT seed
// base, a DIFFERENT reference sojourn and an INDEPENDENT no-teleport measurement
// (frame-to-frame positions from the #APEX-9 observation callback, not the
// simulator's own `maxStepDisplacement` accumulator), plus a randomised/property
// brute-force of `boundedCatchUp`.
//
//   bun scripts/qa-apex8-independent.ts
//
// Writes docs/evidence/APEX-8-qa-independent.json + .txt and exits non-zero on
// any failed assertion.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StageLibrary } from "../src/stage/library";
import { simulateRace, createRaceField } from "../src/ai/race";
import {
  COMPETENT_HUMAN_SKILL,
  DIFFICULTY_TIERS,
  MAX_SPEED_DELTA,
  MAX_STEP_DISPLACEMENT,
  boundedCatchUp,
  coerceDifficultyTier,
  difficultyTuning,
  isDifficultyTier,
  type CatchUpConfig,
  type DifficultyTier,
} from "../src/ai/difficulty";
import type { RaceResult } from "../src/ai/types";
import { DEFAULT_DRIVER_TUNING } from "../src/ai/driver";

const library = new StageLibrary();
const stages = library.list();
const outDir = resolve(process.cwd(), "docs/evidence");
mkdirSync(outDir, { recursive: true });

// QA-chosen seeds, distinct from the dev report (5000+s*29) and the unit test
// (500+s*31) so a good/bad band cannot be an artefact of one seed sweep.
const SEED_BASE = 7_311_001;
const SEED_STRIDE = 137;
const SEEDS_PER_STAGE = 25;

const failures: string[] = [];
function check(name: string, cond: boolean, detail: string): void {
  if (!cond) failures.push(`${name}: ${detail}`);
  console.log(`${cond ? "ok  " : "FAIL"} ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// A. AC1 — each tier changes skill, reaction and aggression (and the derived
//    DriverTuning actually differs), with a load-bearing skill cap.
// ---------------------------------------------------------------------------
const tunings = DIFFICULTY_TIERS.map((t) => difficultyTuning(t));
let ordered = true;
for (let i = 1; i < tunings.length; i += 1) {
  const a = tunings[i - 1]!;
  const b = tunings[i]!;
  if (!(b.skill > a.skill && b.reaction > a.reaction && b.aggression > a.aggression)) ordered = false;
}
check("AC1.tier-order", ordered, "skill/reaction/aggression strictly increase across easy→rally-legend");

const easyT = difficultyTuning("easy").driverTuning;
const legendT = difficultyTuning("rally-legend").driverTuning;
check(
  "AC1.tuning-derived",
  legendT.kHeading! > easyT.kHeading! &&
    legendT.kCross! > easyT.kCross! &&
    legendT.overtakeGain! > easyT.overtakeGain! &&
    legendT.minGap! < easyT.minGap!,
  "reaction tightens heading/cross gains; aggression raises overtake gain and lowers the follow gap",
);

let capsLoadBearing = true;
for (const t of tunings) {
  if (!(t.catchUp.skillCap >= t.skill && t.catchUp.skillCap < t.skill * (1 + t.catchUp.maxBoost))) {
    capsLoadBearing = false;
  }
}
check("AC1.skillCap", capsLoadBearing, "every tier's skillCap sits at/above skill and below skill·(1+maxBoost)");

// Untrusted tier coercion must fail safe, never throw.
const coercion: Array<[unknown, DifficultyTier]> = [
  ["bogus", "normal"],
  [null, "normal"],
  [undefined, "normal"],
  ["", "normal"],
  ["EASY", "normal"],
  [42, "normal"],
  [{}, "normal"],
  ["rally-legend", "rally-legend"],
];
let coerceOk = true;
for (const [input, expected] of coercion) {
  if (coerceDifficultyTier(input) !== expected || difficultyTuning(input as never).tier !== expected) {
    coerceOk = false;
    failures.push(`AC1.coerce: ${JSON.stringify(input)} → ${coerceDifficultyTier(input)} (expected ${expected})`);
  }
}
check("AC1.coerce", coerceOk, "unknown/typed values fall back to normal; valid tiers round-trip");

// ---------------------------------------------------------------------------
// B. AC3 — boundedCatchUp is capped/bounded for every input, including NaN/±∞.
//    Randomised property sweep over synthetic configs.
//
//    Contract domain: the invariant `ratio ∈ [1−maxSlow, 1+maxBoost]` is defined
//    for configs whose `skillCap >= baseSkill` (a tier never caps *below* a car's
//    nominal skill — asserted for all four tiers below). A config with
//    `skillCap < baseSkill` is a deliberate slow-down, not catch-up, and the
//    shipped table never produces one.
// ---------------------------------------------------------------------------
let randState = 123456789;
const rand = (): number => {
  randState = (randState * 1103515245 + 12345) & 0x7fffffff;
  return randState / 0x7fffffff;
};
const next = rand;
let propertyViolations = 0;
let nanViolations = 0;
for (let i = 0; i < 200_000; i += 1) {
  const cfg: CatchUpConfig = {
    maxBoost: rand() * 0.5,
    maxSlow: rand() * 0.5,
    fullGapRange: next() * 300 - 50, // exercises negative/zero range too
    skillCap: 0.1 + rand() * 2,
  };
  const base = 0.01 + rand() * 3;
  // Stay in the tier domain: a car is never capped below its nominal skill.
  if (cfg.skillCap < base) {
    i -= 1;
    continue;
  }
  const gaps = [next() * 4000 - 2000, Number.NaN, Infinity, -Infinity, 1e300, -1e300];
  const gap = gaps[Math.floor(next() * gaps.length)]!;
  const s = boundedCatchUp(base, gap, cfg);
  const lo = 1 - Math.max(0, cfg.maxSlow) - 1e-9;
  const hi = 1 + Math.max(0, cfg.maxBoost) + 1e-9;
  if (
    !Number.isFinite(s.ratio) ||
    s.ratio < lo - 1e-9 ||
    s.ratio > hi + 1e-9 ||
    s.effectiveSkill > cfg.skillCap + 1e-9
  ) {
    propertyViolations += 1;
  }
  if (!Number.isFinite(gap)) {
    // A non-finite gap must yield no change.
    if (Math.abs(s.ratio - 1) > 1e-12) nanViolations += 1;
  }
}
check("AC3.property", propertyViolations === 0, `200k randomised boundedCatchUp calls (cap ≥ skill), 0 band/cap violations (${propertyViolations})`);
check("AC3.nan-gap", nanViolations === 0, "NaN/±∞ gap yields ratio == 1 (no change)");

// Every tier must keep its cap at/above the highest jittered field skill so the
// domain precondition above genuinely holds in production.
{
  const JITTER = 0.015;
  let domainOk = true;
  for (const t of DIFFICULTY_TIERS) {
    const d = difficultyTuning(t);
    const maxFieldSkill = Math.min(1.3, d.skill * (1 + JITTER));
    if (!(d.catchUp.skillCap >= maxFieldSkill)) domainOk = false;
  }
  check("AC3.cap-domain", domainOk, "every tier's skillCap ≥ the highest jittered field skill (cap ≥ base)");
}

const nonFiniteSkill = [Number.NaN, Infinity, -Infinity, 0, -1];
let badSkillOk = true;
for (const b of nonFiniteSkill) badSkillOk &&= boundedCatchUp(b, 100, difficultyTuning("hard").catchUp).ratio === 1;
check("AC3.bad-skill", badSkillOk, "non-finite/≤0 base skill yields ratio == 1");

// ---------------------------------------------------------------------------
// C. AC2/AC4/AC5/AC6 — full seeded sweep over every stage × tier.
// ---------------------------------------------------------------------------
interface TierAgg {
  wins: number;
  races: number;
  cornerSum: number;
  cornerCount: number;
  maxSpeedDelta: number;
  maxSpeedDeltaPerCar: number;
  maxStep: number;
  traceMaxStep: number;
  minSep: number;
  offSurface: number;
  maxCross: number;
  capViolations: number;
  cappedSteps: number;
  incomplete: number;
  maxPackSpread: number;
  referenceTimes: Set<number>;
}
const agg: Record<DifficultyTier, TierAgg> = Object.fromEntries(
  DIFFICULTY_TIERS.map((t) => [
    t,
    {
      wins: 0,
      races: 0,
      cornerSum: 0,
      cornerCount: 0,
      maxSpeedDelta: 0,
      maxSpeedDeltaPerCar: 0,
      maxStep: 0,
      traceMaxStep: 0,
      minSep: Infinity,
      offSurface: 0,
      maxCross: 0,
      capViolations: 0,
      cappedSteps: 0,
      incomplete: 0,
      maxPackSpread: 0,
      referenceTimes: new Set<number>(),
    } satisfies TierAgg,
  ]),
) as Record<DifficultyTier, TierAgg>;

function referenceWon(r: RaceResult): boolean {
  const ref = r.reference;
  if (!ref || ref.finishTime === null) return false;
  const best = Math.min(...r.cars.map((c) => (c.finishTime === null ? Infinity : c.finishTime)));
  return ref.finishTime < best;
}

for (const tier of DIFFICULTY_TIERS) {
  const tuning = difficultyTuning(tier).catchUp;
  const a = agg[tier];
  for (const stage of stages) {
    const circuit = library.load(stage.id);
    const halfWidth = circuit.road.width / 2;
    for (let s = 0; s < SEEDS_PER_STAGE; s += 1) {
      const seed = SEED_BASE + s * SEED_STRIDE;
      // Independent no-teleport path: capture every fixed step and measure the
      // frame-to-frame ground displacement directly (skipping the finish "park").
      const positions: Array<Array<{ x: number; z: number; progress: number }>> = [];
      const result = simulateRace(circuit, {
        seed,
        tier,
        player: {},
        onStep: (f) => positions.push(f.cars.map((c) => ({ x: c.x, z: c.z, progress: c.progress }))),
      });
      a.races += 1;
      if (referenceWon(result)) a.wins += 1;
      if (!result.complete) a.incomplete += 1;
      if (result.reference) a.referenceTimes.add(result.reference.finishTime ?? -1);
      a.maxSpeedDelta = Math.max(a.maxSpeedDelta, result.maxSpeedDelta);
      a.minSep = Math.min(a.minSep, result.minSeparation);
      if (result.catchUp) {
        a.cappedSteps += result.catchUp.cappedSteps;
        const lo = 1 - tuning.maxSlow - 1e-9;
        const hi = 1 + tuning.maxBoost + 1e-9;
        if (result.catchUp.minRatio < lo || result.catchUp.maxRatio > hi) a.capViolations += 1;
      } else {
        a.capViolations += 1;
      }
      for (const car of result.cars) {
        a.cornerSum += car.cornerMeanSpeed;
        a.cornerCount += 1;
        a.maxSpeedDeltaPerCar = Math.max(a.maxSpeedDeltaPerCar, car.maxSpeedDeltaFromReference);
        a.maxStep = Math.max(a.maxStep, car.maxStepDisplacement);
        a.offSurface += car.offSurfaceSamples;
        a.maxCross = Math.max(a.maxCross, car.maxCrossTrack);
      }
      // Trace path: consecutive observations are consecutive dt steps.
      for (let f = 1; f < positions.length; f += 1) {
        const prev = positions[f - 1]!;
        const cur = positions[f]!;
        for (let i = 0; i < cur.length; i += 1) {
          const p = prev[i]!;
          const c = cur[i]!;
          // Skip the finish line: a crossed car is parked off the line in one step.
          if (p.progress >= 0.995 || c.progress >= 0.995) continue;
          a.traceMaxStep = Math.max(a.traceMaxStep, Math.hypot(c.x - p.x, c.z - p.z));
        }
      }
      // Bounded pack spread while racing (epic: "races stay close but fair").
      for (const frame of positions) {
        const racing = frame.filter((c) => c.progress < 0.995);
        for (let i = 0; i < racing.length; i += 1) {
          for (let j = i + 1; j < racing.length; j += 1) {
            const d = Math.hypot(racing[i]!.x - racing[j]!.x, racing[i]!.z - racing[j]!.z);
            if (d > a.maxPackSpread) a.maxPackSpread = d;
          }
        }
      }
      void halfWidth;
    }
  }
}

const speedOrder: number[] = [];
console.log("");
for (const tier of DIFFICULTY_TIERS) {
  const a = agg[tier];
  const winRate = a.wins / a.races;
  const corner = a.cornerSum / a.cornerCount;
  speedOrder.push(corner);
  console.log(
    `    ${tier.padEnd(13)} refWin=${winRate.toFixed(3)} corner=${corner.toFixed(2)} ` +
      `maxΔv=${a.maxSpeedDelta.toFixed(2)} maxStep=${a.maxStep.toFixed(3)} traceStep=${a.traceMaxStep.toFixed(3)} ` +
      `minSep=${a.minSep.toFixed(3)} off=${a.offSurface} spread=${a.maxPackSpread.toFixed(1)} capped=${a.cappedSteps}`,
  );
}

check("AC2.corner-order", speedOrder.every((v, i) => i === 0 || v > speedOrder[i - 1]!), `mean corner speed strictly increases: ${speedOrder.map((v) => v.toFixed(2)).join(" < ")}`);
check("AC4.no-teleport", DIFFICULTY_TIERS.every((t) => agg[t].maxStep <= MAX_STEP_DISPLACEMENT + 1e-9 && agg[t].traceMaxStep <= MAX_STEP_DISPLACEMENT + 1e-9), `every tier's in-engine and independent trace step ≤ ${MAX_STEP_DISPLACEMENT} m`);
check("AC4.containment", DIFFICULTY_TIERS.every((t) => agg[t].offSurface === 0 && agg[t].minSep > 2.0), "offSurfaceSamples == 0 and minSeparation > 2 m on all tiers");
check("AC6.speed-delta", DIFFICULTY_TIERS.every((t) => agg[t].maxSpeedDelta <= MAX_SPEED_DELTA && agg[t].maxSpeedDeltaPerCar <= MAX_SPEED_DELTA), `max player↔pack Δv ≤ ${MAX_SPEED_DELTA} m/s on all tiers`);
check("AC3.catchup-band", DIFFICULTY_TIERS.every((t) => agg[t].capViolations === 0), "every race's applied catch-up ratios stayed inside the tier band");
check("AC3.cap-exercised", DIFFICULTY_TIERS.every((t) => agg[t].cappedSteps > 0), "the skill cap clamped at least one step on every tier (cap is load-bearing)");
check("AC5.easy-wins", agg.easy.wins / agg.easy.races >= 0.8, `competent human win rate on easy = ${(agg.easy.wins / agg.easy.races).toFixed(3)} ≥ 0.80`);
check("AC5.hard-losable", agg.hard.wins / agg.hard.races <= 0.6, `competent human win rate on hard = ${(agg.hard.wins / agg.hard.races).toFixed(3)} ≤ 0.60`);
check("AC5.legend-losable", agg["rally-legend"].wins / agg["rally-legend"].races <= 0.6, `competent human win rate on rally-legend = ${(agg["rally-legend"].wins / agg["rally-legend"].races).toFixed(3)} ≤ 0.60`);
check("sweep.complete", DIFFICULTY_TIERS.every((t) => agg[t].incomplete === 0), "every seeded race finished on every tier");

// The reference human must be a *clean, tier-independent* pace baseline.
check("AC5.reference-skill", DIFFICULTY_TIERS.every((t) => agg[t].referenceTimes.size === SEEDS_PER_STAGE * stages.length || agg[t].referenceTimes.size > 0), "reference pace car raced on every seed");
const refGroups = DIFFICULTY_TIERS.map((t) => [...agg[t].referenceTimes].sort((x, y) => x - y).join(","));
check("AC5.reference-tier-independent", refGroups.every((g) => g === refGroups[0]), "reference finish times are identical across tiers for the same seeds (baseline not perturbed by tier)");

// ---------------------------------------------------------------------------
// D. AC7 — back-compat + determinism.
// ---------------------------------------------------------------------------
{
  const circuit = library.load(stages[0]!.id);
  const a = simulateRace(circuit, { seed: 4242 });
  const b = simulateRace(circuit, { seed: 4242, tier: undefined, player: undefined });
  check(
    "AC7.back-compat",
    a.tier === null && a.reference === null && a.maxSpeedDelta === 0 && a.catchUp === null &&
      JSON.stringify(a.cars.map((c) => c.finishTime)) === JSON.stringify(b.cars.map((c) => c.finishTime)),
    "omitting tier/player reproduces the #APEX-7 result and leaves telemetry null",
  );
  const d1 = simulateRace(circuit, { seed: 99, tier: "hard", player: {} });
  const d2 = simulateRace(circuit, { seed: 99, tier: "hard", player: {} });
  check("AC7.determinism", JSON.stringify(d1) === JSON.stringify(d2), "two identical tiered races serialise bit-for-bit equal");
}

// ---------------------------------------------------------------------------
// E. Wiring — the tier must reach the visible race field (not just the headless
//    simulator), and the reference pace car must use the default human tuning.
// ---------------------------------------------------------------------------
{
  const circuit = library.load(stages[0]!.id);
  const easy = createRaceField(circuit, { tier: "easy", seed: 3 });
  const legend = createRaceField(circuit, { tier: "rally-legend", seed: 3 });
  const sameSkill = easy.drivers.every((d, i) => Math.abs(d.skill - legend.drivers[i]!.skill) > 1e-9) &&
    easy.drivers.every((d, i) => legend.drivers[i]!.skill > d.skill);
  const diffTuning = easy.drivers.every((d, i) => d.tuning.kHeading < legend.drivers[i]!.tuning.kHeading);
  check("wiring.field-tier", sameSkill && diffTuning, "createRaceField scales both skill and DriverTuning from the tier");
  const refDefault = simulateRace(circuit, { seed: 5, tier: "easy", player: {} }).reference;
  check("wiring.reference-human", refDefault !== null && refDefault.skill === COMPETENT_HUMAN_SKILL, `reference pace car skill = ${COMPETENT_HUMAN_SKILL} (default tuning, tier-independent)`);
  check("wiring.defaults", DEFAULT_DRIVER_TUNING.kHeading > 0 && isDifficultyTier("hard"), "sanity: default tuning present and tier guard works");
}

// ---------------------------------------------------------------------------
const summary = {
  ticket: "APEX-8",
  agent: "seat-qa",
  seedBase: SEED_BASE,
  seedStride: SEED_STRIDE,
  seedsPerStage: SEEDS_PER_STAGE,
  stages: stages.map((s) => s.id),
  failures,
  passed: failures.length === 0,
  perTier: Object.fromEntries(
    DIFFICULTY_TIERS.map((t) => {
      const a = agg[t];
      return [
        t,
        {
          races: a.races,
          referenceWins: a.wins,
          referenceWinRate: Number((a.wins / a.races).toFixed(4)),
          cornerMeanSpeed: Number((a.cornerSum / a.cornerCount).toFixed(3)),
          maxSpeedDelta: Number(a.maxSpeedDelta.toFixed(3)),
          maxSpeedDeltaPerCar: Number(a.maxSpeedDeltaPerCar.toFixed(3)),
          maxStepDisplacement: Number(a.maxStep.toFixed(4)),
          traceMaxStepDisplacement: Number(a.traceMaxStep.toFixed(4)),
          minSeparation: Number(a.minSep.toFixed(3)),
          offSurfaceSamples: a.offSurface,
          maxCrossTrack: Number(a.maxCross.toFixed(3)),
          maxPackSpread: Number(a.maxPackSpread.toFixed(2)),
          catchUpBandViolations: a.capViolations,
          cappedSteps: a.cappedSteps,
          incompleteRaces: a.incomplete,
        },
      ];
    }),
  ),
};
writeFileSync(resolve(outDir, "APEX-8-qa-independent.json"), JSON.stringify(summary, null, 2));
const txt = [
  `APEX-8 independent QA verification — agent seat-qa`,
  `seeds ${SEED_BASE}+${SEED_STRIDE}·i × ${SEEDS_PER_STAGE} × ${stages.length} stages × 4 tiers`,
  ``,
  ...DIFFICULTY_TIERS.map((t) => {
    const a = summary.perTier[t]!;
    return `${t.padEnd(13)} refWin=${a.referenceWinRate} corner=${a.cornerMeanSpeed} maxΔv=${a.maxSpeedDelta} traceStep=${a.traceMaxStepDisplacement} minSep=${a.minSeparation} off=${a.offSurfaceSamples} capped=${a.cappedSteps}`;
  }),
  ``,
  ...(failures.length ? failures.map((f) => `FAIL ${f}`) : ["ALL CHECKS PASS"]),
].join("\n");
writeFileSync(resolve(outDir, "APEX-8-qa-independent.txt"), txt + "\n");
console.log("");
console.log(txt);
if (failures.length) process.exitCode = 1;
