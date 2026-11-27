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
