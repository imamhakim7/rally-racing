/**
 * Public surface of the stage subsystem.
 *
 * Consumers should import from here: `StageLibrary` to enumerate stages,
 * `createStageScene` to render one, and the pure helpers when they need the
 * resolved data (race loop, HUD, physics, pace notes).
 */
export type {
  Biome,
  CheckpointSpec,
  ContainableVehicle,
  Containment,
  ContainmentDef,
  ContainmentResult,
  GateSpec,
  MinimapSpec,
  RaceStageShape,
  ResolvedGate,
  ResolvedSurfaceSpan,
  RoadDef,
  SplineDef,
  SplinePoint,
  StageCircuit,
  StageWorld,
  StartSpec,
  SurfaceSpec,
  SurfaceType,
  TerrainAppearance,
  TerrainBuild,
  TerrainDef,
  TerrainStats,
  Vec2,
  Vec3,
} from "./types";
export { BIOMES, SURFACE_TYPES } from "./types";

export { StageValidationError, formatStageError, type StageIssue, type StageIssueCode } from "./errors";
export { StageSchema, SUPPORTED_SCHEMA_VERSION, type Schema } from "./schema";
export { validateStage, DEFAULT_MINIMAP_COLOR } from "./validate";
export { loadStage, parseStage } from "./loader";
export {
  StageLibrary,
  collectBundledStages,
  type StageCatalogEntry,
  type StageSource,
} from "./library";
export {
  detectCorners,
  normaliseMinimap,
  projectSplineToMinimap,
  sampleSpline,
  type Corner,
  type SampledSpline,
} from "./spline";
export { buildRoadGeometry, resolveSurfaceSpans, surfaceAt, SURFACE_COLORS } from "./road";
export {
  BIOME_TERRAIN,
  TERRAIN_BUDGET,
  buildTerrain,
  checkTerrainBudget,
  terrainGrid,
  terrainLighting,
  terrainSections,
  terrainStats,
  type TerrainBudgetReport,
  type TerrainLighting,
  type TimeOfDay,
} from "./terrain";
export { createContainment, DEFAULT_CONTAINMENT_SHOULDER } from "./containment";
export { resolveMinimapPath, toSvgPath, type MinimapPath } from "./minimap";
export { buildStageWorld, disposeStageWorld } from "./world";
export { toRaceStage } from "./race-adapter";
export { createStageScene, type StageSceneHandle } from "./scene";
export { mountStageSelect, type StageSelectHandle } from "./select";
