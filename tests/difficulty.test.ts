import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import {
  COMPETENT_HUMAN_SKILL,
  DIFFICULTY_TIERS,
  MAX_SPEED_DELTA,
  MAX_STEP_DISPLACEMENT,
  boundedCatchUp,
  coerceDifficultyTier,
  difficultyTuning,
  isDifficultyTier,
  scaleDriverTuning,
  type DifficultyTier,
} from "../src/ai/difficulty";
import { DEFAULT_DRIVER_TUNING } from "../src/ai/driver";
import { simulateRace } from "../src/ai/race";
import type { RaceResult } from "../src/ai/types";

const library = new StageLibrary();
const stages = library.list();

/** The reference human's finish time vs the fastest CPU in the pack. */
function referenceWon(result: RaceResult): boolean {
  const reference = result.reference;
  expect(reference).not.toBeNull();
  if (!reference || reference.finishTime === null) return false;
  const best = Math.min(
    ...result.cars.map((car) => (car.finishTime === null ? Infinity : car.finishTime)),
  );
  return reference.finishTime < best;
}

describe("difficulty tiers (#APEX-8 AC1)", () => {
  it("exposes the four canonical tiers in weakest-first order", () => {
    expect(DIFFICULTY_TIERS).toEqual(["easy", "normal", "hard", "rally-legend"]);
    for (const tier of DIFFICULTY_TIERS) expect(isDifficultyTier(tier)).toBe(true);
    expect(isDifficultyTier("nightmare")).toBe(false);
    expect(isDifficultyTier(undefined)).toBe(false);
  });

  it("orders skill, reaction and aggression strictly across the tiers", () => {
    const tunings = DIFFICULTY_TIERS.map((tier) => difficultyTuning(tier));
    for (let i = 1; i < tunings.length; i += 1) {
      expect(tunings[i]!.skill).toBeGreaterThan(tunings[i - 1]!.skill);
      expect(tunings[i]!.reaction).toBeGreaterThan(tunings[i - 1]!.reaction);
      expect(tunings[i]!.aggression).toBeGreaterThan(tunings[i - 1]!.aggression);
    }
  });

  it("derives a distinct DriverTuning from reaction and aggression", () => {
    const easy = difficultyTuning("easy").driverTuning;
    const legend = difficultyTuning("rally-legend").driverTuning;
    // Reaction tightens tracking; aggression presses harder and follows closer.
    expect(legend.kHeading!).toBeGreaterThan(easy.kHeading!);
    expect(legend.kCross!).toBeGreaterThan(easy.kCross!);
    expect(legend.overtakeGain!).toBeGreaterThan(easy.overtakeGain!);
    expect(legend.minGap!).toBeLessThan(easy.minGap!);
  });

  it("falls back to normal for unknown/untrusted tiers and never throws", () => {
    expect(coerceDifficultyTier("bogus")).toBe("normal");
    expect(coerceDifficultyTier(null)).toBe("normal");
    expect(difficultyTuning("bogus" as DifficultyTier).tier).toBe("normal");
    expect(difficultyTuning(undefined).label).toBe("Normal");
  });

  it("scaleDriverTuning keeps the default for neutral and guards non-finite input", () => {
    expect(scaleDriverTuning(1, 1)).toEqual({
      kHeading: DEFAULT_DRIVER_TUNING.kHeading,
      kCross: DEFAULT_DRIVER_TUNING.kCross,
      overtakeGain: DEFAULT_DRIVER_TUNING.overtakeGain,
      minGap: DEFAULT_DRIVER_TUNING.minGap,
    });
    const guarded = scaleDriverTuning(Number.NaN, -1);
    expect(guarded.kHeading).toBe(DEFAULT_DRIVER_TUNING.kHeading);
    expect(guarded.overtakeGain).toBe(DEFAULT_DRIVER_TUNING.overtakeGain);
  });
});

describe("bounded catch-up (#APEX-8 AC3)", () => {
  const cfg = difficultyTuning("hard").catchUp;

  it("never leaves the tier's ratio band and never exceeds the skill cap", () => {
    const base = difficultyTuning("hard").skill;
    for (const gap of [-1e9, -500, -40, -1, 0, 1, 40, 500, 1e9]) {
      const state = boundedCatchUp(base, gap, cfg);
      expect(state.ratio).toBeGreaterThanOrEqual(1 - cfg.maxSlow - 1e-9);
      expect(state.ratio).toBeLessThanOrEqual(1 + cfg.maxBoost + 1e-9);
      expect(state.effectiveSkill).toBeLessThanOrEqual(cfg.skillCap + 1e-9);
    }
  });

  it("boosts a car behind and slows a car ahead", () => {
    const base = difficultyTuning("hard").skill;
    const behind = boundedCatchUp(base, cfg.fullGapRange, cfg);
    const ahead = boundedCatchUp(base, -cfg.fullGapRange, cfg);
    expect(behind.factor).toBeCloseTo(1 + cfg.maxBoost, 9);
    expect(ahead.factor).toBeCloseTo(1 - cfg.maxSlow, 9);
    expect(behind.ratio).toBeGreaterThan(1);
    expect(ahead.ratio).toBeLessThan(1);
  });

  it("reports capped when a saturated boost hits the skill cap", () => {
    const base = difficultyTuning("hard").skill;
    const saturated = boundedCatchUp(base, cfg.fullGapRange, cfg);
    expect(saturated.capped).toBe(true);
    expect(saturated.effectiveSkill).toBeCloseTo(cfg.skillCap, 9);
  });

  it("does nothing (ratio 1) for a non-finite gap or skill", () => {
    expect(boundedCatchUp(1, Number.NaN, cfg).ratio).toBe(1);
    expect(boundedCatchUp(Number.NaN, 10, cfg).ratio).toBe(1);
    expect(boundedCatchUp(1, 10, { ...cfg, fullGapRange: 0 }).ratio).toBeGreaterThanOrEqual(1);
  });

  it("caps every tier's skillCap below skill·(1+maxBoost) so the cap is load-bearing", () => {
    for (const tier of DIFFICULTY_TIERS) {
      const t = difficultyTuning(tier);
      expect(t.catchUp.skillCap).toBeGreaterThanOrEqual(t.skill);
      expect(t.catchUp.skillCap).toBeLessThan(t.skill * (1 + t.catchUp.maxBoost) + 1e-9);
    }
  });
});

describe("tiered racing balance (#APEX-8 AC2, AC5, AC6)", () => {
  const seedsPerStage = 6;

  function cornerSpeeds(tier: DifficultyTier): number {
    let sum = 0;
    let count = 0;
    for (const stage of stages) {
      const circuit = library.load(stage.id);
      for (let s = 0; s < seedsPerStage; s += 1) {
        const result = simulateRace(circuit, { seed: 500 + s * 31, tier, player: {} });
        for (const car of result.cars) {
          sum += car.cornerMeanSpeed;
          count += 1;
        }
      }
    }
    return sum / count;
  }

  function winRate(tier: DifficultyTier): number {
    let wins = 0;
    let total = 0;
    for (const stage of stages) {
      const circuit = library.load(stage.id);
      for (let s = 0; s < seedsPerStage; s += 1) {
        const result = simulateRace(circuit, { seed: 500 + s * 31, tier, player: {} });
        if (referenceWon(result)) wins += 1;
        total += 1;
      }
    }
    return wins / total;
  }

  it("AC2: a higher tier corners faster, strictly ordered across tiers", () => {
    const speeds = DIFFICULTY_TIERS.map((tier) => cornerSpeeds(tier));
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });

  it("AC5: a competent human wins on easy and can lose on hard/legend", () => {
    const easy = winRate("easy");
    const hard = winRate("hard");
    const legend = winRate("rally-legend");
    expect(easy).toBeGreaterThanOrEqual(0.8);
    expect(hard).toBeLessThanOrEqual(0.6);
    expect(legend).toBeLessThanOrEqual(0.6);
  });

  it("AC6: telemetry shows bounded speed deltas and in-band catch-up ratios", () => {
    for (const tier of DIFFICULTY_TIERS) {
      const tuning = difficultyTuning(tier);
      const circuit = library.load(stages[0]!.id);
      const result = simulateRace(circuit, { seed: 123, tier, player: {} });
      expect(result.tier).toBe(tier);
      expect(result.playerId).toBe("player");
      expect(result.reference!.skill).toBe(COMPETENT_HUMAN_SKILL);
      expect(result.maxSpeedDelta).toBeGreaterThanOrEqual(0);
      expect(result.maxSpeedDelta).toBeLessThanOrEqual(MAX_SPEED_DELTA);
      expect(result.catchUp).not.toBeNull();
      expect(result.catchUp!.minRatio).toBeGreaterThanOrEqual(1 - tuning.catchUp.maxSlow - 1e-9);
      expect(result.catchUp!.maxRatio).toBeLessThanOrEqual(1 + tuning.catchUp.maxBoost + 1e-9);
      for (const car of result.cars) {
        expect(car.maxSpeedDeltaFromReference).toBeLessThanOrEqual(MAX_SPEED_DELTA);
      }
    }
  });
});

describe("tiered racing containment & no-teleport (#APEX-8 AC4)", () => {
  it("keeps every car on the ribbon and never jumps a step on any tier/stage/seed", () => {
    for (const tier of DIFFICULTY_TIERS) {
      for (const stage of stages) {
        const circuit = library.load(stage.id);
        const halfWidth = circuit.road.width / 2;
        for (const seed of [1, 7, 123, 6186]) {
          const result = simulateRace(circuit, { seed, tier, player: {} });
          for (const car of result.cars) {
            expect(car.finishTime).not.toBeNull();
            expect(car.offSurfaceSamples).toBe(0);
            expect(car.maxCrossTrack).toBeLessThanOrEqual(halfWidth + 1e-6);
            expect(car.maxStepDisplacement).toBeLessThanOrEqual(MAX_STEP_DISPLACEMENT);
          }
          expect(result.minSeparation).toBeGreaterThan(2.0);
        }
      }
    }
  });
});

describe("back-compat and determinism (#APEX-8 AC7)", () => {
  it("omitting tier/player reproduces the #APEX-7 field exactly", () => {
    const circuit = library.load(stages[0]!.id);
    const a = simulateRace(circuit, { seed: 42 });
    const b = simulateRace(circuit, { seed: 42, tier: undefined, player: undefined });
    expect(a.tier).toBeNull();
    expect(a.playerId).toBeNull();
    expect(a.reference).toBeNull();
    expect(a.maxSpeedDelta).toBe(0);
    expect(a.catchUp).toBeNull();
    expect(a.cars.map((c) => c.finishTime)).toEqual(b.cars.map((c) => c.finishTime));
    expect(a.finishOrder).toEqual(b.finishOrder);
  });

  it("is bit-for-bit deterministic for the same tiered inputs", () => {
    const circuit = library.load(stages[1]!.id);
    const a = simulateRace(circuit, { seed: 99, tier: "hard", player: {} });
    const b = simulateRace(circuit, { seed: 99, tier: "hard", player: {} });
    expect(a.cars.map((c) => c.finishTime)).toEqual(b.cars.map((c) => c.finishTime));
    expect(a.cars.map((c) => c.maxCrossTrack)).toEqual(b.cars.map((c) => c.maxCrossTrack));
    expect(a.reference!.finishTime).toBe(b.reference!.finishTime);
    expect(a.maxSpeedDelta).toBe(b.maxSpeedDelta);
  });

  it("uses the seed to vary a tiered field", () => {
    const circuit = library.load(stages[0]!.id);
    const a = simulateRace(circuit, { seed: 1, tier: "normal" });
    const b = simulateRace(circuit, { seed: 2, tier: "normal" });
    expect(a.cars.map((c) => c.skill)).not.toEqual(b.cars.map((c) => c.skill));
  });
});
