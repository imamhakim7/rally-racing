/** Public surface of the vehicle-physics module. */

export { pacejka, pacejkaPeakSlip, DEFAULT_TYRE_SHAPE, type PacejkaCurve } from "./pacejka";
export {
  SURFACES,
  SURFACE_IDS,
  getSurface,
  createSurfaceMap,
  createLaneSurfaceMap,
  type Surface,
  type SurfaceId,
  type SurfaceMap,
  type SurfaceZone,
} from "./surface";
export {
  Vehicle,
  DEFAULT_VEHICLE_CONFIG,
  NEUTRAL_INPUT,
  type VehicleConfig,
  type VehicleInput,
  type VehicleState,
  type VehicleTelemetry,
} from "./vehicle";
export { toDebugHud, formatDebugHud, type DebugHudState } from "./debug";
export { clamp, clamp01, wrapAngle, damp } from "./util";
