/**
 * Domain types for the data-driven stage circuit format (v1).
 *
 * Everything here is plain data: a `StageCircuit` is the *validated* result of
 * loading a stage JSON file, and `StageWorld` is the three.js world built from
 * it. Keeping the two apart means validation and world-building are independently
 * testable and the race loop (#APEX-3), HUD (#APEX-10) and biomes (#APEX-5) all
 * consume the same resolved circuit.
 */
import type * as THREE from "three";

/** A point in stage space. `y` is up. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A 2-D point in normalised minimap space (0..1, z already flipped for drawing). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The surfaces a stage can be made of. Kept as a closed union so a typo in a
 * JSON file is caught by the validator rather than silently falling back.
 */
export const SURFACE_TYPES = [
  "tarmac",
  "gravel",
  "dirt",
  "grass",
  "water",
  "sand",
  "snow",
  "mud",
] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Biome label — data only in this ticket; #APEX-5 renders the nature. */
export const BIOMES = [
  "forest",
  "alpine",
  "coastal",
  "valley",
  "canyon",
  "desert",
  "tundra",
] as const;

export type Biome = (typeof BIOMES)[number];

/** One control point of the centreline. Only x/z are layout-significant; y is height. */
export interface SplinePoint {
  x: number;
  y: number;
  z: number;
}

export interface SplineDef {
  /** Whether the centreline loops back to its first point. */
  closed: boolean;
  /** Catmull-Rom tension in [0,1]; 0 = tight, 1 = loose. */
  tension: number;
  /** Control points, at least two. */
  points: SplinePoint[];
}

export interface RoadDef {
  /** Full road width in metres (the ribbon is centred on the spline). */
  width: number;
  /** Distance in metres between generated cross-sections. */
  sampleStep: number;
  /** Default surface for the whole road; surface zones override spans. */
  surface: SurfaceType;
  /** Crossfall/banking in degrees; positive banks into the corner. */
  bankingDeg: number;
}

export interface GateSpec {
  width: number;
  height: number;
}

export interface CheckpointSpec {
  id: string;
  name: string;
  /** Arc-length fraction along the centreline, in [0,1]. */
  t: number;
  width: number;
  height: number;
}

export interface SurfaceSpec {
  id: string;
  surface: SurfaceType;
  /** Start of the half-open [from, to) span, arc-length fraction. */
  from: number;
  to: number;
  /** Surface grip scalar handed to the vehicle model (#APEX-2). */
  grip: number;
  /** Optional water depth in metres (for fords/puddles). */
  depth?: number;
}

export interface StartSpec {
  position: readonly [number, number, number];
  headingDeg: number;
}

export interface FinishSpec {
  t: number;
  gate: GateSpec;
}

export interface MinimapSpec {
  color: string;
  /** `"auto"` projects the centreline; an explicit list overrides it. */
  path: "auto" | Vec2[];
}

/** A validated, normalised stage — every optional field has been defaulted. */
export interface StageCircuit {
  schemaVersion: 1;
  id: string;
  name: string;
  biome: Biome;
  difficulty: number;
  start: StartSpec;
  finish: FinishSpec;
  spline: SplineDef;
  road: RoadDef;
  checkpoints: CheckpointSpec[];
  surfaces: SurfaceSpec[];
  minimap: MinimapSpec;
  /** Where the circuit came from (file name / URL) — used in error messages. */
  source: string;
}

/** A checkpoint (or the finish) resolved to a world transform. */
export interface ResolvedGate {
  id: string;
  name: string;
  /** 0-based order; the finish is the last gate. */
  index: number;
  kind: "checkpoint" | "finish";
  t: number;
  position: Vec3;
  /** Yaw in radians so the gate faces across the road. */
  heading: number;
  width: number;
  height: number;
  surface: SurfaceType;
}

/** A surface zone resolved to its span of generated cross-sections. */
export interface ResolvedSurfaceSpan {
  id: string;
  surface: SurfaceType;
  from: number;
  to: number;
  grip: number;
  depth?: number;
  /** Inclusive first sample index. */
  startIndex: number;
  /** Inclusive last sample index; shared with the next span's `startIndex`. */
  endIndex: number;
}

/** The three.js world generated from a circuit. */
export interface StageWorld {
  readonly circuit: StageCircuit;
  readonly group: THREE.Group;
  /** Gates in stage order; the finish is last. */
  readonly gates: ResolvedGate[];
  readonly surfaces: ResolvedSurfaceSpan[];
  readonly road: THREE.Mesh;
  /** Axis-aligned bounds of the road + gates. */
  readonly bounds: THREE.Box3;
  /** Normalised minimap path + an SVG `d` string for the HUD. */
  readonly minimap: { points: Vec2[]; d: string };
}

/** Minimal shape #APEX-3's race loop needs; kept structural so we do not import it. */
export interface RaceStageShape {
  id: string;
  name: string;
  checkpoints: { id: string; index: number; name: string }[];
  finishId: string;
  gateCount: number;
}
