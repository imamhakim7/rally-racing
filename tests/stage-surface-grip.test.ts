import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { physicsSurfaceAt } from "../src/ai/surface";
import type { SurfaceId } from "../src/physics/surface";
import type { SurfaceType } from "../src/stage/types";

const library = new StageLibrary();
const stages = library.list().map((entry) => library.load(entry.id));

/** The physics class each stage surface resolves to (#APEX-2 mapping). */
const PHYSICS: Record<SurfaceType, SurfaceId> = {
  tarmac: "tarmac",
  gravel: "gravel",
  dirt: "gravel",
  sand: "gravel",
  grass: "gravel",
  snow: "mud",
  mud: "mud",
  water: "mud",
};

describe("stage surface grip parity (#APEX-28 AC2)", () => {
  it("resolves every shipped surface zone to its authored grip and physics class", () => {
    for (const circuit of stages) {
      for (const zone of circuit.surfaces) {
        const midpoint = zone.to >= 1 ? (zone.from + zone.to) / 2 : zone.from + (zone.to - zone.from) / 2;
        const surface = physicsSurfaceAt(circuit, midpoint);
        expect(surface.stageType, `${circuit.id}/${zone.id}`).toBe(zone.surface);
        expect(surface.id, `${circuit.id}/${zone.id}`).toBe(PHYSICS[zone.surface]);
        expect(surface.lateralGrip, `${circuit.id}/${zone.id}`).toBeCloseTo(zone.grip, 6);
        expect(surface.longitudinalGrip, `${circuit.id}/${zone.id}`).toBeCloseTo(zone.grip, 6);
      }
    }
  });

  it("covers the acceptance surfaces tarmac, gravel, snow and dirt", () => {
    const seen = new Set(stages.flatMap((c) => c.surfaces.map((z) => z.surface)));
    for (const required of ["tarmac", "gravel", "snow", "dirt"] as const) {
      expect(seen.has(required), `no shipped zone uses ${required}`).toBe(true);
    }
  });
});
