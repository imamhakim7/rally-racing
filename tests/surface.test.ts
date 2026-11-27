import { describe, expect, it } from "vitest";
import {
  createLaneSurfaceMap,
  createSurfaceMap,
  getSurface,
  SURFACES,
  SURFACE_IDS,
} from "../src/physics/surface";

describe("surface definitions", () => {
  it("defines every surface with matching id/label", () => {
    for (const id of SURFACE_IDS) {
      expect(SURFACES[id].id).toBe(id);
      expect(SURFACES[id].label.length).toBeGreaterThan(0);
    }
    expect(getSurface("ice").lateralGrip).toBe(SURFACES.ice.lateralGrip);
  });

  it("orders grip tarmac > gravel > mud > ice, measurably", () => {
    const order = ["tarmac", "gravel", "mud", "ice"] as const;
    for (let i = 1; i < order.length; i++) {
      const better = SURFACES[order[i - 1]!];
      const worse = SURFACES[order[i]!];
      expect(better.lateralGrip).toBeGreaterThan(worse.lateralGrip);
      expect(better.longitudinalGrip).toBeGreaterThan(worse.longitudinalGrip);
      // A visibly different coefficient, not a rounding-level nudge.
      expect(better.lateralGrip - worse.lateralGrip).toBeGreaterThan(0.1);
    }
  });

  it("resolves a point to its zone or the fallback", () => {
    const map = createSurfaceMap(
      [{ surface: "gravel", minX: 0, maxX: 10, minZ: -10, maxZ: 10 }],
      "ice",
    );
    expect(map.surfaceAt(5, 0).id).toBe("gravel");
    expect(map.surfaceAt(-5, 0).id).toBe("ice");
    expect(map.surfaceAt(5, 20).id).toBe("ice");
  });

  it("lays the lane map out tarmac → gravel → mud → ice along +X", () => {
    const map = createLaneSurfaceMap(10);
    expect(map.zones).toHaveLength(4);
    expect(map.surfaceAt(5, 0).id).toBe("tarmac");
    expect(map.surfaceAt(15, 0).id).toBe("gravel");
    expect(map.surfaceAt(25, 0).id).toBe("mud");
    expect(map.surfaceAt(35, 0).id).toBe("ice");
  });
});
