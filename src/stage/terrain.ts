/**
 * Terrain foundation (#APEX-28).
 *
 * Builds a deterministic heightfield ribbon around a stage's centreline and
 * paints it with the biome's surface material. The whole layer is data-driven:
 * the `terrain` block in the stage JSON plus the `BIOME_TERRAIN` lookup table
 * decide the look, so adding a stage or a biome is a content edit and the builder
 * never branches on `biome`.
 *
 * Nothing here uses `Math.random` or a clock: the same circuit always produces the
 * same heightfield, which keeps the world reproducible and the layer headlessly
 * testable. Foliage, sky and weather (#APEX-29) layer on the `terrainLighting`
 * seam this module prints.
 */
import * as THREE from "three";
import type {
  Biome,
  StageCircuit,
  TerrainAppearance,
  TerrainBuild,
  TerrainStats,
} from "./types";
import type { SampledSpline } from "./spline";

/** The biome look-up table: no per-biome branches anywhere else. */
export const BIOME_TERRAIN: Record<Biome, TerrainAppearance> = {
  forest: { ground: 0x33502a, ridge: 0x6f8452, roughness: 0.96, reliefScale: 1.4, ridgeHeight: 14 },
  alpine: { ground: 0x51606b, ridge: 0xe4ecf1, roughness: 0.9, reliefScale: 1.8, ridgeHeight: 22 },
  coastal: { ground: 0x9a8f6a, ridge: 0xcdc6a4, roughness: 1.0, reliefScale: 0.7, ridgeHeight: 9 },
  valley: { ground: 0x4c6b3a, ridge: 0x8faa63, roughness: 0.97, reliefScale: 0.9, ridgeHeight: 11 },
  canyon: { ground: 0x8a5a3c, ridge: 0xd09060, roughness: 1.0, reliefScale: 1.6, ridgeHeight: 20 },
  desert: { ground: 0xc9a86a, ridge: 0xe6cf96, roughness: 1.0, reliefScale: 0.8, ridgeHeight: 8 },
  tundra: { ground: 0x8fa0a8, ridge: 0xe8eef2, roughness: 0.92, reliefScale: 1.2, ridgeHeight: 15 },
};

/** The per-stage terrain frame budget, checked at midday and dusk. */
export const TERRAIN_BUDGET = {
  maxTriangles: 16_000,
  maxDrawCalls: 4,
} as const;

/** Cap on cross-sections along the road; keeps the ribbon within budget. */
const MAX_ALONG_SECTIONS = 240;
/** Terrain sits this far below the road ribbon so it never pokes through. */
const ROAD_EPSILON = 0.04;

export type TimeOfDay = "midday" | "dusk";

export interface TerrainLighting {
  sunColor: number;
  sunIntensity: number;
  sunDirection: readonly [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
}

/**
 * Lighting the terrain is rendered under. Geometry is time-of-day invariant, so
 * the draw/triangle budget is identical at midday and dusk; #APEX-29 owns the
 * dynamic sky that will drive this seam.
 */
export function terrainLighting(timeOfDay: TimeOfDay): TerrainLighting {
  if (timeOfDay === "dusk") {
    return {
      sunColor: 0xff9d5c,
      sunIntensity: 1.35,
      sunDirection: [-70, 26, 55],
      ambientColor: 0x6b5b86,
      ambientIntensity: 0.5,
    };
  }
  return {
    sunColor: 0xfff0d0,
    sunIntensity: 2.0,
    sunDirection: [60, 90, 40],
    ambientColor: 0x9dc4ff,
    ambientIntensity: 0.85,
  };
}

export interface TerrainBudgetReport {
  ok: boolean;
  timeOfDay: TimeOfDay;
  stageId: string;
  stats: TerrainStats;
  limits: { maxTriangles: number; maxDrawCalls: number };
  violations: string[];
}

/* ------------------------------------------------------------------ noise */

/** Deterministic integer-lattice hash in [0,1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (seed >>> 0) ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/** Bilinear value noise over a unit lattice, in [0,1). */
function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = smoothstep(x - xi);
  const v = smoothstep(z - zi);
  const v00 = hash2(xi, zi, seed);
  const v10 = hash2(xi + 1, zi, seed);
  const v01 = hash2(xi, zi + 1, seed);
  const v11 = hash2(xi + 1, zi + 1, seed);
  const top = v00 + (v10 - v00) * u;
  const bottom = v01 + (v11 - v01) * u;
  return top + (bottom - top) * v;
}

/** Four-octave fractional Brownian motion in [0,1). */
function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, z * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/* --------------------------------------------------------------- heightfield */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * The terrain height at arc-length fraction `t` and signed lateral offset.
 *
 * Inside the road half-width the ground is flat and sits a hair below the road
 * ribbon; outside it a smooth bank rises to the corridor edge with seeded relief
 * on top, so the ridge silhouette (and colour) differs per biome and seed.
 */
function heightAt(
  circuit: StageCircuit,
  appearance: TerrainAppearance,
  spline: SampledSpline,
  t: number,
  lateral: number,
): number {
  const frame = spline.sampleAtT(t);
  const half = circuit.road.width / 2;
  const corridor = Math.max(circuit.terrain.corridorWidth, 1e-3);
  const edge = Math.max(0, Math.abs(lateral) - half);
  const k = clamp(edge / corridor, 0, 1);
  const shape = smoothstep(k);
  const bank = appearance.ridgeHeight * shape;
  const relief = circuit.terrain.relief * appearance.reliefScale;
  const noise = fbm(frame.position.x * 0.015 + lateral * 0.03, frame.position.z * 0.015, circuit.terrain.seed);
  const hills = relief * shape * (0.35 + 0.65 * noise);
  return frame.position.y - ROAD_EPSILON + bank + hills;
}

/** Number of cross-sections and the stride used to stay within budget. */
export function terrainSections(spline: SampledSpline): { sections: number; stride: number } {
  const stride = Math.max(1, Math.ceil((spline.count - 1) / (MAX_ALONG_SECTIONS - 1)));
  const sections = Math.max(2, Math.floor((spline.count - 1) / stride) + 1);
  return { sections, stride };
}

/** The deterministic grid the terrain builder uses. */
export function terrainGrid(circuit: StageCircuit, spline: SampledSpline): { sections: number; columns: number } {
  const { sections } = terrainSections(spline);
  return { sections, columns: clamp(Math.round(circuit.terrain.resolution), 5, 64) };
}

/** Draw/triangle cost of a stage's terrain, without touching GPU objects. */
export function terrainStats(circuit: StageCircuit, spline: SampledSpline): TerrainStats {
  const { sections, columns } = terrainGrid(circuit, spline);
  return {
    vertices: sections * columns,
    triangles: (sections - 1) * (columns - 1) * 2,
    drawCalls: 1,
    corridorWidth: circuit.terrain.corridorWidth * 2,
  };
}

/**
 * Check a stage's terrain against the frame budget for a time of day.
 *
 * Geometry is time-of-day invariant (lighting is layered by #APEX-29), so the
 * report is identical at midday and dusk by construction.
 */
export function checkTerrainBudget(
  circuit: StageCircuit,
  spline: SampledSpline,
  timeOfDay: TimeOfDay = "midday",
): TerrainBudgetReport {
  const stats = terrainStats(circuit, spline);
  const violations: string[] = [];
  if (stats.triangles > TERRAIN_BUDGET.maxTriangles) {
    violations.push(`triangles ${stats.triangles} > ${TERRAIN_BUDGET.maxTriangles}`);
  }
  if (stats.drawCalls > TERRAIN_BUDGET.maxDrawCalls) {
    violations.push(`draw calls ${stats.drawCalls} > ${TERRAIN_BUDGET.maxDrawCalls}`);
  }
  return {
    ok: violations.length === 0,
    timeOfDay,
    stageId: circuit.id,
    stats,
    limits: { maxTriangles: TERRAIN_BUDGET.maxTriangles, maxDrawCalls: TERRAIN_BUDGET.maxDrawCalls },
    violations,
  };
}

/* ------------------------------------------------------------------- build */

/**
 * Build the terrain ribbon for a circuit from the same sampled spline as the
 * road. Deterministic: identical `(circuit, spline)` ⇒ identical geometry.
 */
export function buildTerrain(circuit: StageCircuit, spline: SampledSpline): TerrainBuild {
  const appearance = BIOME_TERRAIN[circuit.biome];
  const { sections, columns } = terrainGrid(circuit, spline);
  const corridor = circuit.terrain.corridorWidth;
  const vertexCount = sections * columns;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const ground = new THREE.Color(appearance.ground);
  const ridge = new THREE.Color(appearance.ridge);
  const color = new THREE.Color();
  const maxHeight = appearance.ridgeHeight + circuit.terrain.relief * appearance.reliefScale;

  for (let i = 0; i < sections; i += 1) {
    const t = sections === 1 ? 0 : i / (sections - 1);
    const frame = spline.sampleAtT(t);
    for (let j = 0; j < columns; j += 1) {
      const lateralFrac = columns === 1 ? 0.5 : j / (columns - 1);
      const lateral = -corridor + 2 * corridor * lateralFrac;
      const y = heightAt(circuit, appearance, spline, t, lateral);
      const base = (i * columns + j) * 3;
      positions[base] = frame.position.x + frame.normal.x * lateral;
      positions[base + 1] = y;
      positions[base + 2] = frame.position.z + frame.normal.z * lateral;

      const lift = clamp((y - (frame.position.y - ROAD_EPSILON)) / Math.max(maxHeight, 1e-3), 0, 1);
      color.copy(ground).lerp(ridge, lift);
      colors[base] = color.r;
      colors[base + 1] = color.g;
      colors[base + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < sections - 1; i += 1) {
    for (let j = 0; j < columns - 1; j += 1) {
      const a = i * columns + j;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: appearance.roughness,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;

  return {
    mesh,
    stats: terrainStats(circuit, spline),
    appearance,
    surface: circuit.terrain.surface,
    sampleHeight: (t, lateral) => heightAt(circuit, appearance, spline, t, lateral),
  };
}
