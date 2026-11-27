import { RaceController, type RaceControllerOptions } from "./race";
import type { RacePhase, RaceResult, StageDefinition } from "./types";

export type RaceListener = (controller: RaceController) => void;

/**
 * Binds one `RaceController` to a stage and broadcasts structural changes.
 *
 * `update(dt)` is called once per fixed engine step by the composition root, so
 * the race clock advances in lockstep with the simulation (deterministic and
 * frame-rate independent). Listeners fire on phase changes and on restart/quit
 * so a view can re-render only when the shape of the screen changes; the live
 * timer is read directly from the controller each frame.
 */
export class StageSession {
  readonly stage: StageDefinition;
  readonly controller: RaceController;

  private readonly listeners = new Set<RaceListener>();
  private lastPhase: RacePhase;

  constructor(stage: StageDefinition, options: RaceControllerOptions = {}) {
    this.stage = stage;
    this.controller = new RaceController(options);
    this.lastPhase = this.controller.phase;
  }

  get phase(): RacePhase {
    return this.controller.phase;
  }

  get result(): RaceResult | null {
    return this.controller.result;
  }

  /** Subscribe to structural changes; fires immediately with current state. */
  subscribe(listener: RaceListener): () => void {
    this.listeners.add(listener);
    listener(this.controller);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begin the stage from the countdown. */
  start(): void {
    this.controller.startStage(this.stage);
    this.syncPhase(true);
  }

  /** Advance the race by one fixed step. */
  update(dt: number): void {
    this.controller.update(dt);
    this.syncPhase(false);
  }

  /** Feed a gate crossing into the race (no-op unless racing). */
  crossGate(gateId: string): void {
    this.controller.crossGate(gateId);
    this.syncPhase(false);
  }

  /** Restart the current stage from the countdown. */
  restart(): void {
    this.controller.restart();
    this.syncPhase(true);
  }

  /** Abandon the run and go back to stage select. */
  quit(): void {
    this.controller.quit();
    this.syncPhase(true);
  }

  private syncPhase(force: boolean): void {
    if (force || this.controller.phase !== this.lastPhase) {
      this.lastPhase = this.controller.phase;
      for (const listener of this.listeners) listener(this.controller);
    }
  }
}
