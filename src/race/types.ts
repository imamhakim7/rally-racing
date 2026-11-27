/**
 * Race-loop domain types.
 *
 * These are deliberately free of three.js / DOM dependencies so the race
 * state machine is pure logic and can be driven headlessly by the fixed
 * timestep loop (`update(dt)`) and by injected gate-crossing events.
 */

/** The lifecycle of a single stage run. */
export type RacePhase =
  | "stage_select"
  | "countdown"
  | "racing"
  | "finished"
  | "invalidated";

/** One ordered gate the car must pass through. */
export interface CheckpointDef {
  /** Unique gate id, e.g. `"cp-1"`. Never equal to the finish id. */
  id: string;
  /** 0-based order on the stage; must be dense and ascending. */
  index: number;
  /** Display name, e.g. `"Hairpin"`. */
  name: string;
}

/** A CPU opponent's fixed finishing time (seconds) used for position. */
export interface OpponentDef {
  name: string;
  time: number;
}

/**
 * A target ("reference") cumulative time at one gate, used by the HUD to show
 * whether the player is ahead of or behind pace. `time` is race time at the
 * point the gate is crossed, so the finish entry is the target total.
 */
export interface ReferenceSplit {
  /** Gate id: a checkpoint id, or the stage `finishId`. */
  checkpointId: string;
  /** Cumulative target race time in seconds. */
  time: number;
}

/** The immutable definition of a stage: gates, timing and penalty rules. */
export interface StageDefinition {
  id: string;
  name: string;
  /** Ordered checkpoints that must be crossed before the finish. */
  checkpoints: CheckpointDef[];
  /** Gate id that ends the run; crossed after every checkpoint. */
  finishId: string;
  /** Seconds of "3..2..1..GO" before the timer starts. */
  countdownSeconds: number;
  /** Seconds added per missed checkpoint. */
  penaltySeconds: number;
  /** Misses allowed before the run is invalidated (`missed > maxPenalties`). */
  maxPenalties: number;
  /** CPU times the player's total is ranked against. */
  opponents: OpponentDef[];
  /**
   * Optional target pace per gate (cumulative seconds). When present the HUD
   * shows green/red split deltas and projects the live position against it;
   * when absent the HUD falls back to gate-index progress.
   */
  referenceSplits?: ReferenceSplit[];
}

/** A timing split recorded at a checkpoint or at the finish. */
export interface Split {
  checkpointId: string;
  /** 0..checkpoints.length; the finish split is the last one. */
  index: number;
  /** Seconds since the previous split. */
  delta: number;
  /** Cumulative race time at this split. */
  time: number;
}

/** One row in the results table (player or CPU). */
export interface Standing {
  name: string;
  time: number;
  /** 1-based position (ties share the position). */
  position: number;
  isPlayer: boolean;
}

/** The outcome of a finished (or invalidated) run. */
export interface RaceResult {
  /** False when the run was invalidated by too many missed checkpoints. */
  valid: boolean;
  /** `sum(splits.delta) + penaltySeconds`. */
  totalTime: number;
  /** Ordered splits; the finish split is last (absent on an invalid run). */
  splits: Split[];
  /** Total time added by missed checkpoints. */
  penaltySeconds: number;
  /** Number of missed checkpoints. */
  missedCount: number;
  /** 1-based finish position, or `null` when invalid. */
  position: number | null;
  /** Player + opponents ordered by time; empty when invalid. */
  standings: Standing[];
}
