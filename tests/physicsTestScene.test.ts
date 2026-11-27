import { describe, expect, it } from "vitest";
import { createPhysicsTestScene } from "../src/scenes/physicsTestScene";
import { createLaneSurfaceMap } from "../src/physics/surface";
import type { VehicleInput } from "../src/physics/vehicle";

const DRIVE_FORWARD: VehicleInput = {
  throttle: 1,
  brake: 0,
  steer: 0,
  handbrake: false,
};

describe("physics test scene", () => {
  it("builds a drivable scene with the default vehicle and surface map", () => {
    const scene = createPhysicsTestScene();
    expect(scene.vehicle).toBeInstanceOf(Object);
    expect(scene.surfaceMap.zones).toHaveLength(4);
    expect(scene.scene.children.length).toBeGreaterThan(0);
    scene.dispose();
  });

  it("steps the vehicle and reports telemetry through the callback", () => {
    const seen: number[] = [];
    const scene = createPhysicsTestScene({
      input: () => DRIVE_FORWARD,
      onTelemetry: (telemetry) => seen.push(telemetry.speed),
    });
    for (let i = 0; i < 60; i++) scene.update(1 / 60);
    scene.interpolate(0.5);

    expect(seen).toHaveLength(60);
    expect(seen.at(-1)!).toBeGreaterThan(5);
    scene.dispose();
  });

  it("samples the surface under the car", () => {
    const scene = createPhysicsTestScene({ surfaceMap: createLaneSurfaceMap(12) });
    expect(scene.surface.id).toBe("tarmac");
    scene.vehicle.reset({ x: 18, z: 0 });
    scene.update(1 / 60);
    expect(scene.surface.id).toBe("gravel");
    scene.dispose();
  });

  it("honours setInput when no input source is wired", () => {
    const scene = createPhysicsTestScene();
    scene.setInput(DRIVE_FORWARD);
    for (let i = 0; i < 120; i++) scene.update(1 / 60);
    expect(scene.vehicle.getState().vLong).toBeGreaterThan(5);
    scene.dispose();
  });

  it("resizes and disposes idempotently", () => {
    const scene = createPhysicsTestScene();
    scene.resize(0, 0);
    scene.resize(1280, 720);
    scene.dispose();
    scene.dispose();
    expect(scene.scene.children.length).toBe(0);
  });
});
