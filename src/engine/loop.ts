/**
 * Fixed-timestep game loop (Gaffer-on-Games style).
 *
 * The simulation advances in discrete `fixedDelta` seconds so physics and race
 * logic are deterministic and frame-rate independent; rendering happens once
 * per frame with an interpolation factor (`alpha`) so motion stays smooth
 * between the last two simulated states.
 *
 * The loop is clock-agnostic: `tick(elapsedSeconds)` accepts the elapsed wall
 * time since the previous tick, so tests drive it with synthetic time and the
 * browser driver feeds it `requestAnimationFrame` timestamps.
 */

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds (=== fixedDelta). */
  update: (dt: number) => void;
  /** Draw a frame; `alpha` in [0,1) interpolates between the previous and current state. */
  render: (alpha: number) => void;
}

export interface LoopOptions {
  /** Seconds per simulation step. Defaults to 1/60. */
  fixedDelta?: number;
  /** Upper bound for a single frame's elapsed time, in seconds. Defaults to 0.25.
   *  Clamping prevents a long stall (backgrounded tab, GC pause) from triggering a
   *  "spiral of death" of thousands of catch-up steps. */
  maxDelta?: number;
  /** Override the frame clock (ms). Defaults to `performance.now` / `Date.now`. */
  now?: () => number;
  /** rAF scheduler (browser) — injectable so tests stay headless. */
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

const DEFAULT_FIXED_DELTA = 1 / 60;
const DEFAULT_MAX_DELTA = 0.25;
// Absorbs binary floating-point error so a whole number of fixed steps is not
// starved of its final step (e.g. 60 × (1/60) can sum to 0.9999999999999999).
const STEP_EPSILON = 1e-9;

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function defaultRequestFrame(cb: (t: number) => void): number {
  return requestAnimationFrame(cb);
}

function defaultCancelFrame(handle: number): void {
  cancelAnimationFrame(handle);
}

export class FixedTimestepLoop {
  readonly fixedDelta: number;
  readonly maxDelta: number;

  private readonly callbacks: LoopCallbacks;
  private readonly now: () => number;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  private accumulator = 0;
  private _steps = 0;
  private _running = false;
  private _disposed = false;
  private lastTime: number | null = null;
  private frameHandle: number | null = null;
  // Set while tick() is executing its step loop so stop()/dispose() called from
  // within update() can abort the remaining steps of the current tick.
  private stepAbort = false;
  private inTick = false;

  constructor(callbacks: LoopCallbacks, options: LoopOptions = {}) {
    this.callbacks = callbacks;
    this.fixedDelta = options.fixedDelta ?? DEFAULT_FIXED_DELTA;
    this.maxDelta = options.maxDelta ?? DEFAULT_MAX_DELTA;
    if (!(this.fixedDelta > 0)) throw new Error("fixedDelta must be > 0");
    if (!(this.maxDelta > 0)) throw new Error("maxDelta must be > 0");

    this.now = options.now ?? defaultNow;
    this.requestFrame = options.requestFrame ?? defaultRequestFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  }

  get running(): boolean {
    return this._running;
  }

  /** Total fixed steps simulated since construction. */
  get steps(): number {
    return this._steps;
  }

  /** Interpolation factor in [0,1) for the next render. */
  get alpha(): number {
    return this.accumulator / this.fixedDelta;
  }

  /**
   * Advance the simulation by `elapsedSeconds` of wall time and render one
   * frame. Returns the number of fixed steps that ran. This is the headless
   * entry point used by tests and by the rAF driver.
   */
  tick(elapsedSeconds: number): number {
    if (this._disposed) return 0;

    const raw = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
    const frameTime = Math.min(raw, this.maxDelta);
    this.accumulator += frameTime;

    let stepsThisFrame = 0;
    // Guard against a pathological fixedDelta/maxDelta combo while still being
    // exact: the bound only trips far above any realistic value.
    const maxSteps = Math.ceil(this.maxDelta / this.fixedDelta) + 1;
    this.inTick = true;
    this.stepAbort = false;
    try {
      while (
        this.accumulator >= this.fixedDelta - STEP_EPSILON &&
        stepsThisFrame < maxSteps &&
        !this.stepAbort
      ) {
        this.callbacks.update(this.fixedDelta);
        this.accumulator -= this.fixedDelta;
        stepsThisFrame += 1;
      }
    } finally {
      this.inTick = false;
      this.stepAbort = false;
    }
    if (this.accumulator < 0) this.accumulator = 0;

    this._steps += stepsThisFrame;
    this.callbacks.render(this.alpha);
    return stepsThisFrame;
  }

  /** Begin scheduling ticks from the frame clock. Idempotent while running. */
  start(): void {
    if (this._disposed || this._running) return;
    this._running = true;
    this.lastTime = this.now();
    const frame = (t: number): void => {
      if (!this._running || this._disposed) return;
      const previous = this.lastTime ?? t;
      this.lastTime = t;
      this.tick((t - previous) / 1000);
      // stop()/dispose() may have run inside tick()'s update callback — never
      // re-arm a frame once the loop is no longer running (a stale frame would
      // become a second rAF chain after a restart).
      if (this._running && !this._disposed) {
        this.frameHandle = this.requestFrame(frame);
      } else {
        this.frameHandle = null;
      }
    };
    this.frameHandle = this.requestFrame(frame);
  }

  /** Stop scheduling ticks. Idempotent. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    // If stop() is called from inside an update() step, abort the remaining
    // steps of the current tick instead of finishing them.
    if (this.inTick) this.stepAbort = true;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.lastTime = null;
  }

  /** Stop the loop and release it. Idempotent. */
  dispose(): void {
    this.stop();
    this._disposed = true;
  }
}
