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
export { resolveMinimapPath, toSvgPath, type MinimapPath } from "./minimap";
export { buildStageWorld, disposeStageWorld } from "./world";
export { toRaceStage } from "./race-adapter";
export { createStageScene, type StageSceneHandle } from "./scene";
export { mountStageSelect, type StageSelectHandle } from "./select";
