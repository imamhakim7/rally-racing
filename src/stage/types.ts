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

/**
 * Weather presets (#APEX-29). `clear` is the reference; `rain` is the strongest
 * grip penalty, `fog` trades visibility for grip, `dusk` also moves the time of
 * day. Kept as a closed union so a typo in a JSON file is caught by the validator.
 */
export const WEATHER_PRESETS = ["clear", "rain", "fog", "dusk"] as const;

export type WeatherPreset = (typeof WEATHER_PRESETS)[number];

/**
 * The low-poly primitive a foliage species is drawn with. The builder resolves
 * this through `FOLIAGE_GEOMETRY` (a lookup table), never a `biome` branch.
 */
export const FOLIAGE_KINDS = ["conifer", "broadleaf", "shrub", "rock"] as const;

export type FoliageKind = (typeof FOLIAGE_KINDS)[number];

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
  /** Terrain layer definition (#APEX-28); always present after validation. */
  terrain: TerrainDef;
  /** Foliage layer definition (#APEX-29); always present after validation. */
  foliage: FoliageDef;
  /** Default weather preset (#APEX-29); always present after validation. */
  weather: WeatherPreset;
  /** Where the circuit came from (file name / URL) — used in error messages. */
  source: string;
}

/**
 * Terrain layer definition (#APEX-28). Optional in the file; the validator
 * defaults it deterministically from the stage id so every stage renders ground.
 */
export interface TerrainDef {
  /** Deterministic heightfield seed. */
  seed: number;
  /** Vertical relief amplitude in metres (scaled by the biome style). */
  relief: number;
  /** Lateral columns sampled across the corridor. */
  resolution: number;
  /** Ground surface outside the road (grip is still resolved through surface zones). */
  surface: SurfaceType;
  /** Metres of terrain generated each side of the centreline. */
  corridorWidth: number;
}

/**
 * Foliage layer definition (#APEX-29). Optional in the file; the validator
 * defaults the seed from the terrain seed and density to 1 so every stage is
 * dressed with vegetation.
 */
export interface FoliageDef {
  /** Deterministic scatter seed. */
  seed: number;
  /** Scatter density multiplier (0 = bare, 1 = default, up to 2). */
  density: number;
}

/** One vegetation primitive a biome scatters (lookup-table data, not code). */
export interface FoliageSpecies {
  /** Geometry kind resolved via `FOLIAGE_GEOMETRY`. */
  kind: FoliageKind;
  /** Instance colour. */
  color: number;
  /** Base instance height in metres (jittered per instance). */
  height: number;
  /** Base instance radius in metres. */
  radius: number;
  /** Expected instances per 100 m of corridor edge, scaled by `density`. */
  per100m: number;
  roughness: number;
}

/** The vegetation a biome scatters (a lookup table, never a code branch). */
export interface FoliageStyle {
  /** 1–3 species; each becomes one `InstancedMesh` (one draw call). */
  species: FoliageSpecies[];
  /** Fraction of the corridor band (from road edge to corridor edge) used. */
  band: number;
}

/** Per-stage draw/triangle/instance cost of the foliage layer. */
export interface FoliageStats {
  instances: number;
  triangles: number;
  drawCalls: number;
  species: number;
}

/** A foliage layer built from a circuit; carried on `StageWorld`. */
export interface FoliageBuild {
  readonly group: THREE.Group;
  readonly stats: FoliageStats;
  /** Instance capacity per species, in style order (deterministic). */
  readonly capacities: number[];
}

/** Per-stage draw/triangle cost of the terrain layer. */
export interface TerrainStats {
  vertices: number;
  triangles: number;
  drawCalls: number;
  /** Full corridor span in metres (`2 × corridorWidth`). */
  corridorWidth: number;
}

/** Biome-driven look for the terrain (a lookup table, never a code branch). */
export interface TerrainAppearance {
  /** Low-ground vertex colour. */
  ground: number;
  /** High-ground / ridge vertex colour. */
  ridge: number;
  roughness: number;
  /** Multiplier applied to `TerrainDef.relief`. */
  reliefScale: number;
  /** Bank height in metres at the corridor edge. */
  ridgeHeight: number;
}

/** A terrain ribbon built from a circuit; carried on `StageWorld`. */
export interface TerrainBuild {
  readonly mesh: THREE.Mesh;
  readonly stats: TerrainStats;
  readonly appearance: TerrainAppearance;
  readonly surface: SurfaceType;
  /** Height (m) at arc-length fraction `t` and signed lateral offset (m). */
  sampleHeight(t: number, lateral: number): number;
}

/** Corridor containment config resolved onto a world (#APEX-28). */
export interface ContainmentDef {
  /** Half-width of the drivable corridor in metres (road half + shoulder). */
  halfWidth: number;
  /** Extra shoulder each side beyond the road edge. */
  shoulder: number;
}

/** Minimal vehicle surface containment needs (structurally `Vehicle`). */
export interface ContainableVehicle {
  getState(): { x: number; z: number; yaw: number; vLong: number; vLat: number };
  setState(partial: { x?: number; z?: number; yaw?: number; vLong?: number; vLat?: number }): void;
}

/** The outcome of projecting a car against the corridor. */
export interface ContainmentResult {
  /** True when the car was outside the corridor and got pulled back. */
  contained: boolean;
  /** Signed lateral offset from the centreline (m), before correction. */
  lateral: number;
  /** Corridor half-width (m). */
  limit: number;
  /** Fraction of speed retained after the barrier (1 = no contact). */
  impact: number;
  /** Corrected position (unchanged when already inside). */
  position: Vec3;
  /** Arc-length fraction of the projection. */
  t: number;
}

/** Soft roadside barrier that keeps a car on the road corridor. */
export interface Containment {
  readonly halfWidth: number;
  readonly shoulder: number;
  /** Nearest projection of a world point onto the centreline. */
  project(x: number, z: number): { t: number; lateral: number; position: Vec3; normal: Vec3; heading: number };
  /** Resolve a point/heading against the corridor without mutating anything. */
  resolve(x: number, z: number, yaw: number): ContainmentResult;
  /** Pull a vehicle back inside the corridor, damping it on contact. */
  apply(vehicle: ContainableVehicle): ContainmentResult;
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
  /** Data-driven terrain ribbon (#APEX-28). */
  readonly terrain: TerrainBuild;
  /** Instanced biome foliage (#APEX-29). */
  readonly foliage: FoliageBuild;
  /** Corridor containment resolved for this circuit (#APEX-28). */
  readonly containment: Containment;
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
