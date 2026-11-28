/**
 * Ghost overlay driver (#APEX-9). Browser-safe (no `node:` imports).
 *
 * A `GhostOverlay` wraps a recorded {@link RaceTrace} and exposes interpolated
 * car poses at any simulation time, so a recorded run can be replayed as a ghost
 * and raced against a fresh deterministic run. It owns no rendering — the scene
 * (`src/scenes/aiRaceScene.ts`) reads `poseAt(time)` and places ghost meshes.
 */
import { sampleGhost, type RaceTrace, type TraceFrame } from "./trace";

export class GhostOverlay {
  readonly trace: RaceTrace;

  constructor(trace: RaceTrace) {
    this.trace = trace;
  }

  /** Interpolated ghost frame at `time` (seconds), or `null` for an empty trace. */
  poseAt(time: number): TraceFrame | null {
    return sampleGhost(this.trace, time);
  }

  /** Car ids in the recorded finishing order. */
  get finishOrder(): string[] {
    return this.trace.finishOrder;
  }

  /** Number of ghost cars captured (0 for an empty trace). */
  get carCount(): number {
    return this.trace.frames[0]?.cars.length ?? 0;
  }

  /** Recorded duration in seconds (0 for an empty trace). */
  get duration(): number {
    const frames = this.trace.frames;
    return frames.length > 0 ? frames[frames.length - 1]!.time : 0;
  }
}
