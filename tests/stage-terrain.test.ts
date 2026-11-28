import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { sampleSpline } from "../src/stage/spline";
import { buildTerrain, checkTerrainBudget, terrainLighting } from "../src/stage/terrain";
import { buildStageWorld, disposeStageWorld } from "../src/stage/world";
import type { StageCircuit } from "../src/stage/types";

const library = new StageLibrary();
const stages = library.list().map((entry) => library.load(entry.id));

/** FNV-1a over rounded positions: a cheap deterministic heightfield signature. */
function signature(circuit: StageCircuit): number {
  const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
  const geometry = buildTerrain(circuit, spline).mesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  let hash = 0x811c9dc5;
  for (let i = 0; i < position.count; i += 1) {
    const value = Math.round(position.getY(i) * 1000) + Math.round(position.getX(i) * 10);
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

describe("stage terrain (#APEX-28)", () => {
  it("builds terrain for every shipped stage with a distinct, biome-specific look (AC1)", () => {
    expect(stages.length).toBeGreaterThanOrEqual(6);

    const signatures = new Set<number>();
    const colors = new Set<number>();
    for (const circuit of stages) {
      const world = buildStageWorld(circuit);
      const terrain = world.group.getObjectByName("terrain") as THREE.Mesh | undefined;
      expect(terrain).toBeDefined();
      expect(world.terrain.stats.triangles).toBeGreaterThan(0);
      expect(world.terrain.stats.vertices).toBeGreaterThan(0);
      // Terrain material carries the biome colour via vertex colours.
      const material = terrain!.material as THREE.MeshStandardMaterial;
      expect(material.vertexColors).toBe(true);
      colors.add((world.terrain.appearance.ground << 8) | world.terrain.appearance.ridge);
      signatures.add(signature(circuit));
      disposeStageWorld(world);
    }
    // No two stages render the same heightfield or the same biome palette.
    expect(signatures.size).toBe(stages.length);
    expect(colors.size).toBe(stages.length);
  });

  it("keeps the heightfield below the road inside the corridor (invariant 2)", () => {
    for (const circuit of stages) {
      const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
      const terrain = buildTerrain(circuit, spline);
      for (const t of [0.15, 0.5, 0.85]) {
        const roadY = spline.sampleAtT(t).position.y;
        expect(terrain.sampleHeight(t, 0)).toBeLessThan(roadY);
        // The bank rises away from the road, so the corridor edge is above the road.
        expect(terrain.sampleHeight(t, circuit.terrain.corridorWidth)).toBeGreaterThan(roadY);
      }
    }
  });

  it("is deterministic per stage seed (AC4)", () => {
    const circuit = stages[0]!;
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const a = buildTerrain(circuit, spline).mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const b = buildTerrain(circuit, spline).mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(Array.from(b.array)).toEqual(Array.from(a.array));

    const reseeded: StageCircuit = { ...circuit, terrain: { ...circuit.terrain, seed: circuit.terrain.seed + 1 } };
    expect(signature(reseeded)).not.toBe(signature(circuit));
  });

  it("stays within budget at midday and dusk (AC5)", () => {
    for (const circuit of stages) {
      const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
      const midday = checkTerrainBudget(circuit, spline, "midday");
      const dusk = checkTerrainBudget(circuit, spline, "dusk");
      expect(midday.ok, midday.violations.join("; ")).toBe(true);
      expect(dusk.ok, dusk.violations.join("; ")).toBe(true);
      // Geometry is time-of-day invariant: the cost is identical.
      expect(dusk.stats).toEqual(midday.stats);
      expect(midday.stats.drawCalls).toBeLessThanOrEqual(4);
    }
  });

  it("exposes a midday/dusk lighting seam for #APEX-29", () => {
    const midday = terrainLighting("midday");
    const dusk = terrainLighting("dusk");
    expect(midday.sunColor).not.toBe(dusk.sunColor);
    expect(midday.sunIntensity).toBeGreaterThan(dusk.sunIntensity);
  });
});
