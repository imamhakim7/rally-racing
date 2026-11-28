import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";

// #APEX-27 / #APEX-31: containment is a *state-space* property, not a property
// of eight hand-picked seeds. The first fix passed its own regression list and
// still leaked on `coastal-cliffs` seed 6186 — a seed nobody had tried — and
// then leaked again on 3112/6103/9483 after the speed-ease was reshaped. Keep
// both a named list (every seed QA has ever reported) and a stratified sweep
// so the suite fails on the class, not on one sample.
const library = new StageLibrary();

/** Seeds reported by QA/dev that once put a car past the ribbon. */
const REPORTED: Array<[string, number[]]> = [
  ["mountain-pass", [9, 86, 155, 156, 178, 214, 280]],
  ["coastal-cliffs", [12, 52, 3112, 6103, 6186, 9483]],
];

/** Every shipped stage, so a new stage cannot ship unchecked. */
const STAGES = library.list().map((s) => s.id);

function expectContained(stageId: string, seed: number): void {
  const circuit = library.load(stageId);
  const halfWidth = circuit.road.width / 2;
  const result = simulateRace(circuit, { seed });
  expect(result.complete, `${stageId} seed ${seed} did not finish`).toBe(true);
  for (const car of result.cars) {
    expect(car.offSurfaceSamples, `${stageId} seed ${seed} ${car.id} off-surface`).toBe(0);
    expect(car.maxCrossTrack, `${stageId} seed ${seed} ${car.id} cross-track`).toBeLessThanOrEqual(
      halfWidth + 1e-6,
    );
    // AC4: the containment fix must not cost the finish window (the first
    // revision pushed `mountain-pass` seed 9 to 30.53 s against a 30.27 s cap).
    expect(car.finishTime, `${stageId} seed ${seed} ${car.id} did not finish`).not.toBeNull();
    expect(car.finishTime!, `${stageId} seed ${seed} ${car.id} too slow`).toBeLessThanOrEqual(
      result.window[1],
    );
    expect(car.finishTime!, `${stageId} seed ${seed} ${car.id} too fast`).toBeGreaterThanOrEqual(
      result.window[0],
    );
  }
}

describe("CPU opponents — edge containment regression (#APEX-27)", () => {
  for (const [stageId, seeds] of REPORTED) {
    it(`${stageId}: every reported seed stays on the ribbon and in window`, () => {
      for (const seed of seeds) expectContained(stageId, seed);
    });
  }

  it("holds on a stratified sweep of seeds [0, 10000) on every stage", () => {
    for (const stageId of STAGES) {
      // 103 samples per stage — enough to catch the multi-second dynamics that
      // a fixed list misses, cheap enough to run in the normal suite. The full
      // 60k-race sweep lives in `scripts/qa-apex7-verify.ts`.
      for (let seed = 0; seed < 10_000; seed += 97) expectContained(stageId, seed);
    }
  });
});
