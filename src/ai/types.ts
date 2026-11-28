/**
 * Public types for the CPU opponent driver AI (#APEX-7).
 *
 * Everything here is plain data so the race can be simulated headlessly and its
 * result serialised by the future deterministic harness (#APEX-9). No three.js,
 * no DOM.
 */
import type { Vec3 } from "../stage/types";
import type { TraceFrame } from "./trace";
import type { DifficultyTier } from "./difficulty";

/** One point on the derived racing line, with the speed the car should hold. */
export interface RacingLinePoint {
  /** Index into the source spline. */
  index: number;
  /** World position on the racing line (centreline + lateral offset). */
  position: Vec3;
  /** Forward tangent at this point (unit). */
  tangent: Vec3;
  /** Right-hand normal at this point (unit); `+` is to the driver's right. */
  normal: Vec3;
  /** Signed curvature in 1/m; positive is a right-hand bend. */
  curvature: number;
  /** Feasible target speed in m/s after the brake and acceleration passes. */
  targetSpeed: number;
  /** Lateral offset from the centreline in metres; positive is to the right. */
  offset: number;
  /** Arc distance from the start in metres. */
  distance: number;
}

/** The reference line a CPU driver follows, plus the ideal lap time. */
export interface RacingLine {
  points: RacingLinePoint[];
  /** Total length in metres. */
  length: number;
  /** Road half-width in metres, so the driver knows where the ribbon ends. */
  halfWidth: number;
  /** Ideal lap time in seconds from the feasible speed profile. */
  referenceTime: number;
  /** Interpolated line point at an arc distance (clamped to the line). */
  sampleAtDistance(distance: number): RacingLinePoint;
  /** Nearest sample index for an arc distance (clamped). */
  indexAtDistance(distance: number): number;
}

/** Tunables for {@link buildRacingLine}. */
export interface RacingLineOptions {
  /** Maximum lateral offset as a fraction of the road half-width (default 0.6). */
  maxOffsetFraction?: number;
  /** Corner-cutting gain: metres of offset per (1/m) of curvature (default 12). */
  cornerCut?: number;
  /** Lateral acceleration the tyres can hold, as a fraction of `grip·g` (default 0.9). */
  lateralEfficiency?: number;
  /** Top speed cap in m/s (default 40). */
  vMax?: number;
  /** Assumed braking deceleration for the backward pass, m/s² (default 7). */
  brakeDecel?: number;
  /** Assumed traction acceleration for the forward pass, m/s² (default 5). */
  accel?: number;
  /** Smoothing window (samples) applied to the lateral offset (default 5). */
  offsetSmoothing?: number;
}

/** One CPU car to enter in a race. */
export interface CpuCarSpec {
  id: string;
  /** Speed/willingness scalar; `1` is the reference line speed (default from seed). */
  skill?: number;
  /** Preferred lateral offset bias in metres (grid position / lane). Default 0. */
  lineOffset?: number;
  /**
   * #APEX-8: explicit `DriverTuning` overrides for this car, which win over the
   * tier's tuning. The reference pace car passes `{}` so a tier's reaction/
   * aggression never changes the human baseline it is graded against.
   */
  tuning?: Partial<import("./driver").DriverTuning>;
}

/** Result for a single car after a simulated race. */
export interface CarResult {
  id: string;
  skill: number;
  /** Finish time in seconds, or `null` if the car did not finish within `maxSeconds`. */
  finishTime: number | null;
  /** Off-road samples recorded (cross-track beyond the ribbon) — should be 0. */
  offSurfaceSamples: number;
  /** Maximum absolute cross-track error seen, in metres. */
  maxCrossTrack: number;
  /** Mean speed on straight samples (m/s). */
  straightMeanSpeed: number;
  /** Mean speed on corner samples (m/s). */
  cornerMeanSpeed: number;
  /** Final progress as an arc-length fraction in [0,1]. */
  progress: number;
  /**
   * #APEX-8: largest `|carSpeed − referenceSpeed|` seen while racing (m/s).
   * `0` when the race has no reference player. The bounded-delta telemetry.
   */
  maxSpeedDeltaFromReference: number;
  /**
   * #APEX-8: largest per-step ground displacement (m). The no-teleport evidence:
   * catch-up only shapes commands, so this stays below `vMax·dt` (plus margin).
   */
  maxStepDisplacement: number;
}

/** The full result of a headless race. */
export interface RaceResult {
  stageId: string;
  seed: number;
  /** Fixed simulation step in seconds. */
  dt: number;
  cars: CarResult[];
  /** Car ids in finishing order (finishers first). */
  finishOrder: string[];
  /** Minimum pairwise centre distance seen across the race, in metres. */
  minSeparation: number;
  /** Ideal lap time derived from the racing line, in seconds. */
  referenceTime: number;
  /** Target finish window `[low, high]` in seconds. */
  window: [number, number];
  /** `true` when every car finished. */
  complete: boolean;
  /** #APEX-8: the difficulty tier the CPU field was tuned to, or `null`. */
  tier: DifficultyTier | null;
  /** #APEX-8: id of the reference player car, or `null` when none raced. */
  playerId: string | null;
  /**
   * #APEX-8: the reference "competent human" pace car's own result (it races the
   * line as a ghost, outside the collision field), or `null` when none raced.
   * Compare its `finishTime` to the pack to grade a tier's win rate.
   */
  reference: CarResult | null;
  /**
   * #APEX-8: largest player↔pack `|Δspeed|` over every racing step (m/s), or `0`
   * when no reference player raced. Bounded by `MAX_SPEED_DELTA` in practice.
   */
  maxSpeedDelta: number;
  /**
   * #APEX-8: catch-up ratio range actually applied (and how many car-steps the
   * skill cap clamped), or `null` when no catch-up ran.
   */
  catchUp: { minRatio: number; maxRatio: number; cappedSteps: number } | null;
}

/** Tunables for {@link simulateRace}. */
export interface RaceOptions {
  cars?: CpuCarSpec[];
  /** Overrides merged into every car's `DriverTuning` (difficulty, tests). */
  driverTuning?: Partial<import("./driver").DriverTuning>;
  /** Seed for the deterministic PRNG. Default 1. */
  seed?: number;
  /** Fixed step in seconds. Default 1/60. */
  dt?: number;
  /** Hard cap on simulated seconds. Default 240. */
  maxSeconds?: number;
  /** Lower window factor applied to `referenceTime`. Default 0.75. */
  windowLowFactor?: number;
  /** Upper window factor applied to `referenceTime`. Default 1.6. */
  windowHighFactor?: number;
  /**
   * #APEX-9: capture an observation frame every `sampleEvery` steps. The callback
   * is purely observational — it never mutates race state, so passing it does not
   * change the `RaceResult`. Defaults to no capture.
   */
  onStep?: (frame: TraceFrame) => void;
  /** #APEX-9: capture one frame every this many fixed steps. Default 1. */
  sampleEvery?: number;
  /**
   * #APEX-8: difficulty tier for the CPU field. When set, every CPU's skill is
   * scaled by the tier and its `DriverTuning` comes from the tier's
   * reaction/aggression. Omit to reproduce the #APEX-7 field exactly.
   */
  tier?: DifficultyTier;
  /**
   * #APEX-8: enter a deterministic reference "competent human" pace car and apply
   * bounded catch-up against it. Used to grade tier balance headlessly.
   */
  player?: { id?: string; skill?: number };
}
