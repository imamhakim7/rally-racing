/**
 * Public surface of the CPU opponent driver AI (#APEX-7) and the deterministic
 * harness / replay types (#APEX-9).
 *
 * Browser-safe: this barrel deliberately does **not** re-export `replay.ts` or
 * `harness.ts`, which import `node:crypto` (node-only, used by tests/CLI/CI).
 * Import those directly from their modules in node contexts.
 */

export {
  buildRacingLine,
} from "./racing-line";
export {
  CpuDriver,
  DEFAULT_DRIVER_TUNING,
  type CpuDriverOptions,
  type DriverTuning,
} from "./driver";
export { physicsSurfaceAt, type PhysicsSurface } from "./surface";
export { simulateRace, createRaceField, parkOffLineCar, type RaceField } from "./race";
export { mulberry32 } from "./rng";
export { GhostOverlay } from "./ghost";
export {
  sampleGhost,
  tracesEqual,
  TRACE_VERSION,
  type RaceTrace,
  type TraceFrame,
  type TracePose,
  type TraceSplit,
} from "./trace";
export type {
  CarResult,
  CpuCarSpec,
  RaceOptions,
  RaceResult,
  RacingLine,
  RacingLineOptions,
  RacingLinePoint,
} from "./types";
