import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { createAiRaceScene } from "../src/scenes/aiRaceScene";

const library = new StageLibrary();

describe("visible AI race scene", () => {
  it("renders four cars that make progress along the stage", () => {
    const circuit = library.load(library.list()[0]!.id);
    const scene = createAiRaceScene(circuit, { seed: 7 });
    expect(scene.carCount).toBe(4);

    for (let i = 0; i < 60 * 3; i += 1) {
      scene.update(1 / 60);
      scene.interpolate(0);
    }
    expect(scene.simulationTime).toBeCloseTo(3, 3);
    expect(scene.leaderProgress).toBeGreaterThan(0);
    expect(scene.leaderId).toMatch(/^cpu-/);

    const snap = scene.snapshot();
    expect(snap.cars).toHaveLength(4);
    expect(snap.onScreen).toBeGreaterThanOrEqual(1);
    expect(snap.roadHalfWidth).toBeGreaterThan(0);
    scene.dispose();
  });

  it("runs a full race in which every car stays on the road and never overlaps", () => {
    const circuit = library.load(library.list()[0]!.id);
    const scene = createAiRaceScene(circuit, { seed: 7 });
    const halfWidth = circuit.road.width / 2;

    let minSeparation = Infinity;
    let offRoad = 0;
    let steps = 0;
    while (steps < 60 * 60) {
      scene.update(1 / 60);
      scene.interpolate(0);
      const snap = scene.snapshot();
      for (const car of snap.cars) {
        if (!car.finished && Math.abs(car.centerOffset) > halfWidth + 1e-6) offRoad += 1;
      }
      for (let i = 0; i < snap.cars.length; i += 1) {
        for (let j = i + 1; j < snap.cars.length; j += 1) {
          const d = Math.hypot(
            snap.cars[i]!.x - snap.cars[j]!.x,
            snap.cars[i]!.z - snap.cars[j]!.z,
          );
          minSeparation = Math.min(minSeparation, d);
        }
      }
      steps += 1;
      if (snap.cars.every((c) => c.finished)) break;
    }

    const final = scene.snapshot();
    expect(final.cars.every((c) => c.finished)).toBe(true);
    expect(offRoad).toBe(0);
    expect(minSeparation).toBeGreaterThan(2.0);
    scene.dispose();
  });

  it("resizes its camera without error", () => {
    const circuit = library.load(library.list()[0]!.id);
    const scene = createAiRaceScene(circuit, { seed: 1 });
    scene.resize(0, 0);
    scene.resize(1280, 720);
    expect(scene.camera.aspect).toBeCloseTo(1280 / 720, 5);
    scene.dispose();
  });
});
