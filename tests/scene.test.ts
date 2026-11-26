import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createPlaceholderScene } from "../src/engine/scene";

describe("createPlaceholderScene", () => {
  it("builds a populated scene with a perspective camera", () => {
    const handle = createPlaceholderScene();
    expect(handle.scene.children.length).toBeGreaterThan(0);
    expect(handle.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    handle.dispose();
  });

  it("keeps the camera aspect in sync with resize and guards zero size", () => {
    const handle = createPlaceholderScene();
    handle.resize(1600, 900);
    expect(handle.camera.aspect).toBeCloseTo(1600 / 900, 6);

    handle.resize(0, 0);
    expect(handle.camera.aspect).toBe(1);
    handle.dispose();
  });

  it("interpolates the placeholder transform between updates", () => {
    const handle = createPlaceholderScene();
    const car = handle.scene.children.find(
      (child): child is THREE.Group => child instanceof THREE.Group,
    );
    expect(car).toBeDefined();

    handle.update(1 / 60);
    handle.interpolate(0.5);
    // Halfway between the previous and current yaw — not equal to either end.
    expect(car!.rotation.y).toBeGreaterThan(0);

    handle.interpolate(0);
    expect(car!.rotation.y).toBe(0);
    handle.dispose();
  });

  it("disposes every geometry and material exactly once (AC4)", () => {
    const handle = createPlaceholderScene();

    const meshes: THREE.Mesh[] = [];
    handle.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    expect(meshes.length).toBeGreaterThan(0);

    const geometrySpies = meshes.map((mesh) =>
      vi.spyOn(mesh.geometry, "dispose").mockImplementation(() => {}),
    );
    const materialSpies = meshes.flatMap((mesh) => {
      const material = mesh.material;
      const list = Array.isArray(material) ? material : [material];
      return list.map((entry) => vi.spyOn(entry, "dispose").mockImplementation(() => {}));
    });

    handle.dispose();
    handle.dispose(); // idempotent — must not double-dispose

    for (const spy of [...geometrySpies, ...materialSpies]) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(handle.scene.children).toHaveLength(0);
  });
});
