import { describe, expect, it, vi } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { createStageScene } from "../src/stage/scene";
import { clone, makeStageDocument } from "./stage-fixtures";

function twoStageLibrary(): StageLibrary {
  const alpha = clone(makeStageDocument());
  alpha.id = "alpha";
  alpha.name = "Alpha Stage";
  const beta = clone(makeStageDocument());
  beta.id = "beta";
  beta.name = "Beta Stage";
  beta.biome = "coastal";
  return new StageLibrary([
    { source: "alpha.json", data: alpha },
    { source: "beta.json", data: beta },
  ]);
}

describe("stage scene handle", () => {
  it("implements the engine SceneHandle port", () => {
    const scene = createStageScene(twoStageLibrary());
    expect(scene.scene).toBeDefined();
    expect(scene.camera).toBeDefined();
    expect(typeof scene.update).toBe("function");
    expect(typeof scene.interpolate).toBe("function");
    expect(typeof scene.resize).toBe("function");
    expect(typeof scene.dispose).toBe("function");
    scene.dispose();
  });

  it("swaps stages live and disposes the previous world (AC8)", () => {
    const scene = createStageScene(twoStageLibrary());
    expect(scene.current.id).toBe("alpha");

    const previousGeometry = scene.world.road.geometry;
    const spy = vi.spyOn(previousGeometry, "dispose").mockImplementation(() => {});

    const circuit = scene.load("beta");

    expect(circuit.id).toBe("beta");
    expect(scene.current.id).toBe("beta");
    expect(scene.scene.getObjectByName("stage:alpha")).toBeUndefined();
    expect(scene.scene.getObjectByName("stage:beta")).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);

    scene.dispose();
  });

  it("keeps the camera aspect in sync and guards zero size", () => {
    const scene = createStageScene(twoStageLibrary());
    scene.resize(1600, 900);
    expect(scene.camera.aspect).toBeCloseTo(1600 / 900, 6);
    scene.resize(0, 0);
    expect(scene.camera.aspect).toBe(1);
    scene.dispose();
  });

  it("is inert after dispose", () => {
    const scene = createStageScene(twoStageLibrary());
    scene.dispose();
    scene.dispose(); // idempotent
    expect(() => scene.load("beta")).toThrow(/disposed/);
  });
});
