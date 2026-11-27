import {
  playerPosition,
  positionForTime,
  rankStandings,
  referenceTimeAt,
  sumSplits,
} from "./results";
import type {
  CheckpointDef,
  RacePhase,
  RaceResult,
  Split,
  StageDefinition,
} from "./types";

export interface RaceControllerOptions {
  /** Upper bound for a single `update(dt)` step (seconds). Defaults to 1. */
  maxDelta?: number;
  /** Label used for the player row in the standings. Defaults to "You". */
  playerName?: string;
}

const DEFAULT_MAX_DELTA = 1;
const STEP_EPSILON = 1e-9;

function sanitizeDelta(dt: number, maxDelta: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, maxDelta);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The stage race lifecycle: `stage_select -> countdown -> racing -> finished`
 * (with `invalidated` when too many checkpoints are missed).
 *
 * The controller owns *all* race state — the timer, ordered checkpoints, splits
 * and penalties. It is pure: time arrives through `update(dt)` from the
 * fixed-timestep loop and the world notifies it of gate crossings through
 * `crossGate(id)`. Restart and quit reset every field, so a new run needs no
 * page reload.
 */
export class RaceController {
  readonly maxDelta: number;
  readonly playerName: string;

  private _phase: RacePhase = "stage_select";
  private _stage: StageDefinition | null = null;
  private _countdownRemaining = 0;
  private _elapsed = 0;
  private _nextIndex = 0;
  private _splits: Split[] = [];
  private _lastSplitTime = 0;
  private _penaltySeconds = 0;
  private _missedCount = 0;
  private _result: RaceResult | null = null;

  constructor(options: RaceControllerOptions = {}) {
    this.maxDelta = options.maxDelta ?? DEFAULT_MAX_DELTA;
    if (!(this.maxDelta > 0)) throw new Error("maxDelta must be > 0");
    this.playerName = options.playerName ?? "You";
  }

  get phase(): RacePhase {
    return this._phase;
  }

  get stage(): StageDefinition | null {
    return this._stage;
  }

  /** Seconds of race time elapsed since the timer started (penalty-free). */
  get elapsed(): number {
    return this._elapsed;
  }

  /** True only while racing — countdown/stage-select/finished gate input out. */
  get inputEnabled(): boolean {
    return this._phase === "racing";
  }

  /** Whole seconds left on the countdown (ceil), 0 once racing. */
  get countdownRemaining(): number {
    return this._phase === "countdown" ? Math.max(0, Math.ceil(this._countdownRemaining - STEP_EPSILON)) : 0;
  }

  /** The next checkpoint that must be crossed, or `null` when none remain. */
  get nextCheckpoint(): CheckpointDef | null {
    if (!this._stage || this._phase !== "racing") return null;
    return this._stage.checkpoints[this._nextIndex] ?? null;
  }

  get missedCount(): number {
    return this._missedCount;
  }

  get penaltySeconds(): number {
    return this._penaltySeconds;
  }

  get result(): RaceResult | null {
    return this._result;
  }

  /** The most recent split recorded, or `null` before the first gate. */
  get lastSplit(): Split | null {
    return this._splits[this._splits.length - 1] ?? null;
  }

  /**
   * Fraction of the route completed, in [0,1], for the HUD's progress dot.
   *
   * Uses the reference pace when the stage declares it (race-time fraction at
   * the last gate over the target total), otherwise the gate-index fraction.
   * `1` at the finish, `0` before the first split.
   */
  get progressRatio(): number {
    if (this._phase === "finished") return 1;
    if (!this._stage) return 0;
    const last = this.lastSplit;
    if (!last) return 0;

    const reference = this._stage.referenceSplits;
    const target = referenceTimeAt(reference, this._stage.finishId);
    const reached = referenceTimeAt(reference, last.checkpointId);
    if (target !== null && reached !== null && target > 0) {
      return clamp01(reached / target);
    }

    const gateCount = this._stage.checkpoints.length + 1;
    return clamp01((last.index + 1) / gateCount);
  }

  /**
   * Live (projected) finish position while racing: the player's current pace
   * extrapolated to the line and ranked against fixed opponent times. `null`
   * until the first split, so the HUD never claims a position on the start
   * line. Not a substitute for `result.position` once finished.
   */
  get projectedPosition(): number | null {
    if (!this._stage || this._phase !== "racing") return null;
    if (!this.lastSplit) return null;
    const ratio = this.progressRatio;
    if (!(ratio > 0)) return null;
    const projectedFinish = this._elapsed / ratio;
    return positionForTime(projectedFinish, this._stage.opponents);
  }

  /**
   * Load a stage and enter the countdown. Rejected while a run is already
   * counting down or racing — one stage at a time.
   */
  startStage(stage: StageDefinition): void {
    if (this._phase === "countdown" || this._phase === "racing") return;
    this._stage = stage;
    this._enterCountdown();
  }

  /** Advance the countdown / race clock by one fixed step. */
  update(dt: number): void {
    const step = sanitizeDelta(dt, this.maxDelta);
    if (step === 0) return;

    if (this._phase === "countdown") {
      this._countdownRemaining -= step;
      if (this._countdownRemaining <= STEP_EPSILON) this._enterRacing();
      return;
    }

    if (this._phase === "racing") {
      this._elapsed += step;
    }
  }

  /**
   * Notify the race that a gate was crossed. Ignored unless racing, so the
   * countdown genuinely gates input. Crossings of a later checkpoint imply the
   * ones in between were missed and are penalised before the crossing counts.
   */
  crossGate(gateId: string): void {
    if (this._phase !== "racing" || !this._stage) return;
    const stage = this._stage;
    if (gateId === stage.finishId) {
      this._finishRun();
      return;
    }

    const checkpoint = stage.checkpoints.find((cp) => cp.id === gateId);
    if (!checkpoint) return; // unknown gate
    if (checkpoint.index < this._nextIndex) return; // already crossed

    this._applyMissesUpTo(checkpoint.index);
    if (this._phase !== "racing") return; // invalidated while penalising

    this._recordSplit(checkpoint.id, checkpoint.index);
    this._nextIndex = checkpoint.index + 1;
  }

  /** Explicitly finish (the finish gate also calls this via `crossGate`). */
  finish(): void {
    if (this._phase === "racing") this._finishRun();
  }

  /** Run the current stage again from the countdown with zero residual state. */
  restart(): void {
    if (!this._stage) {
      this._phase = "stage_select";
      return;
    }
    this._enterCountdown();
  }

  /** Abandon the run and return to stage select, clearing all state. */
  quit(): void {
    this._stage = null;
    this._phase = "stage_select";
    this._resetRunState();
  }

  // --- internals ---------------------------------------------------------

  private _enterCountdown(): void {
    this._resetRunState();
    this._phase = "countdown";
    this._countdownRemaining = this._stage?.countdownSeconds ?? 0;
    if (this._countdownRemaining <= STEP_EPSILON) this._enterRacing();
  }

  private _enterRacing(): void {
    this._phase = "racing";
    this._elapsed = 0;
    this._lastSplitTime = 0;
  }

  private _resetRunState(): void {
    this._countdownRemaining = 0;
    this._elapsed = 0;
    this._nextIndex = 0;
    this._splits = [];
    this._lastSplitTime = 0;
    this._penaltySeconds = 0;
    this._missedCount = 0;
    this._result = null;
  }

  /** Penalise every checkpoint skipped between `_nextIndex` and `targetIndex`. */
  private _applyMissesUpTo(targetIndex: number): void {
    const stage = this._stage;
    if (!stage) return;
    while (this._nextIndex < targetIndex) {
      this._nextIndex += 1;
      this._missedCount += 1;
      this._penaltySeconds += stage.penaltySeconds;
    }
    if (this._missedCount > stage.maxPenalties) {
      this._phase = "invalidated";
      this._result = this._buildResult(false);
    }
  }

  private _recordSplit(checkpointId: string, index: number): void {
    this._splits.push({
      checkpointId,
      index,
      delta: this._elapsed - this._lastSplitTime,
      time: this._elapsed,
    });
    this._lastSplitTime = this._elapsed;
  }

  private _finishRun(): void {
    const stage = this._stage;
    if (!stage) return;

    // Any checkpoints never crossed are missed and penalised at the line.
    this._applyMissesUpTo(stage.checkpoints.length);
    if (this._phase !== "racing") return; // invalidated

    this._recordSplit(stage.finishId, stage.checkpoints.length);
    this._phase = "finished";
    this._result = this._buildResult(true);
  }

  private _buildResult(valid: boolean): RaceResult {
    const totalTime = sumSplits(this._splits) + this._penaltySeconds;
    if (!valid) {
      return {
        valid: false,
        totalTime,
        splits: [...this._splits],
        penaltySeconds: this._penaltySeconds,
        missedCount: this._missedCount,
        position: null,
        standings: [],
      };
    }
    const standings = rankStandings(this.playerName, totalTime, this._stage?.opponents ?? []);
    return {
      valid: true,
      totalTime,
      splits: [...this._splits],
      penaltySeconds: this._penaltySeconds,
      missedCount: this._missedCount,
      position: playerPosition(standings),
      standings,
    };
  }
}
