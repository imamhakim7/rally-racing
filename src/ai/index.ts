/** Public surface of the CPU opponent driver AI (#APEX-7). */

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
export { simulateRace, createRaceField, type RaceField } from "./race";
export { mulberry32 } from "./rng";
export type {
  CarResult,
  CpuCarSpec,
  RaceOptions,
  RaceResult,
  RacingLine,
  RacingLineOptions,
  RacingLinePoint,
} from "./types";
