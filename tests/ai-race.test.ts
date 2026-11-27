import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";
import type { RaceResult } from "../src/ai/types";

const library = new StageLibrary();
const stages = library.list();

/** Assert the full acceptance contract for one result. */
function expectValidRace(result: RaceResult, halfWidth: number): void {
  expect(result.complete).toBe(true);
  for (const car of result.cars) {
    expect(car.finishTime).not.toBeNull();
    // AC1: never leaves the road surface.
    expect(car.offSurfaceSamples).toBe(0);
    expect(car.maxCrossTrack).toBeLessThanOrEqual(halfWidth + 1e-6);
    // AC2: corner speed below straight speed.
    expect(car.cornerMeanSpeed).toBeLessThan(car.straightMeanSpeed);
    // AC4: finish inside the per-stage target window.
    expect(car.finishTime!).toBeGreaterThanOrEqual(result.window[0]);
    expect(car.finishTime!).toBeLessThanOrEqual(result.window[1]);
  }
  // AC3: no two cars occupy the same point.
  expect(result.minSeparation).toBeGreaterThan(2.0);
}

describe("CPU opponents — four-car race on every shipped stage", () => {
  it("ships at least six stages to race on", () => {
    expect(stages.length).toBeGreaterThanOrEqual(6);
  });

  for (const stage of stages) {
    it(`completes ${stage.id} with all cars on-surface, in-window and separated`, () => {
      const circuit = library.load(stage.id);
      const result = simulateRace(circuit, { seed: 1 });
      expectValidRace(result, circuit.road.width / 2);
    });
  }

  it("holds the contract across several seeds", () => {
    for (const stage of stages) {
      const circuit = library.load(stage.id);
      for (const seed of [7, 42, 1234]) {
        const result = simulateRace(circuit, { seed });
        expectValidRace(result, circuit.road.width / 2);
      }
    }
  });
});

describe("determinism", () => {
  it("produces identical results for the same seed", () => {
    const circuit = library.load(stages[0]!.id);
    const a = simulateRace(circuit, { seed: 123 });
    const b = simulateRace(circuit, { seed: 123 });

    expect(a.cars.map((c) => c.finishTime)).toEqual(b.cars.map((c) => c.finishTime));
    expect(a.cars.map((c) => c.progress)).toEqual(b.cars.map((c) => c.progress));
    expect(a.cars.map((c) => c.maxCrossTrack)).toEqual(b.cars.map((c) => c.maxCrossTrack));
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.minSeparation).toBe(b.minSeparation);
  });

  it("uses the seed to vary the field", () => {
    const circuit = library.load(stages[0]!.id);
    const a = simulateRace(circuit, { seed: 1 });
    const b = simulateRace(circuit, { seed: 2 });
    expect(a.cars.map((c) => c.skill)).not.toEqual(b.cars.map((c) => c.skill));
  });

  it("runs a custom field and still finishes", () => {
    const circuit = library.load(stages[0]!.id);
    const result = simulateRace(circuit, {
      seed: 5,
      cars: [
        { id: "p1", skill: 1.02 },
        { id: "p2", skill: 0.95 },
        { id: "p3", skill: 0.99 },
      ],
    });
    expect(result.cars.map((c) => c.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.complete).toBe(true);
    expect(result.finishOrder).toHaveLength(3);
  });
});
