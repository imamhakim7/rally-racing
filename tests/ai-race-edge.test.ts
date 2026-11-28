import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";

// #APEX-27: these (stage, seed) pairs made a CPU car put a wheel beyond the
// ribbon on the shipped stages. The driver must ease before the edge, not only
// after the line error grows.
const library = new StageLibrary();

const CASES: Array<[string, number[]]> = [
  ["mountain-pass", [86, 155, 156, 178, 214, 280]],
  ["coastal-cliffs", [12, 52]],
];

describe("CPU opponents — edge containment regression (#APEX-27)", () => {
  for (const [stageId, seeds] of CASES) {
    it(`${stageId}: every seed keeps all four cars on the ribbon`, () => {
      const circuit = library.load(stageId);
      const halfWidth = circuit.road.width / 2;
      for (const seed of seeds) {
        const result = simulateRace(circuit, { seed });
        expect(result.complete, `${stageId} seed ${seed} did not finish`).toBe(true);
        for (const car of result.cars) {
          expect(car.offSurfaceSamples, `${stageId} seed ${seed} ${car.id} off-surface`).toBe(0);
          expect(car.maxCrossTrack, `${stageId} seed ${seed} ${car.id} cross-track`).toBeLessThanOrEqual(halfWidth + 1e-6);
        }
      }
    });
  }
});
