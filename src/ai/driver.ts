/**
 * CPU opponent driver.
 *
 * A deterministic geometric controller: pure-pursuit steering toward a
 * lookahead point on the racing line, cross-track correction back onto the line,
 * a speed controller that tracks the line's feasible corner speed, and a
 * separation/overtake rule so cars hold a gap instead of driving through each
 * other. It emits a plain `VehicleInput` — the same interface a human uses — so
 * #APEX-2's `Vehicle` drives it unchanged.
 *
 * No wall clock, no `Math.random`, no DOM/three.js: identical state ⇒ identical
 * command, which is what makes a race reproducible for a seed.
 */
import { clamp, clamp01, wrapAngle } from "../physics/util";
import type { Surface } from "../physics/surface";
import { Vehicle, type VehicleInput } from "../physics/vehicle";
import type { RacingLine } from "./types";

/** Tuning for {@link CpuDriver}. Exposed so #APEX-8 can scale difficulty. */
export interface DriverTuning {
  lookaheadBase: number;
  lookaheadSpeed: number;
  lookaheadMin: number;
  lookaheadMax: number;
  /** Steer gain on heading error. */
  kHeading: number;
  /** Steer gain on cross-track error (metres). */
  kCross: number;
  /** Throttle gain on speed error. */
  kThrottle: number;
  /** Brake gain on speed error. */
  kBrake: number;
  /** Range (m) at which an opponent ahead is considered. */
  avoidRange: number;
  /** Lateral band (m) within which we steer away from an opponent. */
  avoidLateral: number;
  /** Lateral corridor (m) within which an opponent ahead actually blocks us. */
  blockLateral: number;
  /** Preferred following gap (m). */
  minGap: number;
  /** How hard to steer around a slower car ahead. */
  overtakeGain: number;
}

export const DEFAULT_DRIVER_TUNING: DriverTuning = {
  lookaheadBase: 7,
  lookaheadSpeed: 0.7,
  lookaheadMin: 6,
  lookaheadMax: 26,
  kHeading: 1.9,
  kCross: 0.17,
  kThrottle: 0.3,
  kBrake: 0.4,
  avoidRange: 20,
  avoidLateral: 2.6,
  blockLateral: 1.8,
  minGap: 8,
  overtakeGain: 0.4,
};

export interface CpuDriverOptions {
  id: string;
  /** Target-speed multiplier; `1` follows the line exactly (default 1). */
  skill?: number;
  /** Target lateral offset from the racing line, metres (default 0). */
  lineOffset?: number;
  vehicle?: Vehicle;
  tuning?: Partial<DriverTuning>;
}

interface Flat {
  x: number;
  z: number;
}

export class CpuDriver {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly skill: number;
  readonly lineOffset: number;
  readonly tuning: DriverTuning;

  private progressIndex = 0;
  private progressDistance = 0;
  private completed = false;
  private completedAt: number | null = null;
  /** Last measured offset of the car from the road centreline (m). */
  private lastCenterOffset = 0;
  /** Signed curvature at the car's last projected line point (1/m). */
  private lastCurvature = 0;

  constructor(options: CpuDriverOptions) {
    this.id = options.id;
    this.skill = clamp(options.skill ?? 1, 0.5, 1.3);
    this.lineOffset = options.lineOffset ?? 0;
    this.vehicle = options.vehicle ?? new Vehicle();
    this.tuning = { ...DEFAULT_DRIVER_TUNING, ...(options.tuning ?? {}) };
  }

  get distance(): number {
    return this.progressDistance;
  }

  get finished(): boolean {
    return this.completed;
  }

  get finishTime(): number | null {
    return this.completedAt;
  }

  /** Offset of the car from the road centreline as of the last projection (m). */
  get centerOffset(): number {
    return this.lastCenterOffset;
  }

  /** Signed curvature at the last projected line point (1/m). */
  get curvature(): number {
    return this.lastCurvature;
  }

  /** Rectangular position on the ground plane. */
  position(): Flat {
    const s = this.vehicle.getState();
    return { x: s.x, z: s.z };
  }

  /** Speed magnitude in m/s. */
  speed(): number {
    const s = this.vehicle.getState();
    return Math.hypot(s.vLong, s.vLat);
  }

  /** Place the car on the line at `distance`, facing the tangent. */
  placeOnLine(line: RacingLine, distance: number, lateralOffset = this.lineOffset): void {
    const point = line.sampleAtDistance(distance);
    const x = point.position.x + point.normal.x * lateralOffset;
    const z = point.position.z + point.normal.z * lateralOffset;
    const yaw = Math.atan2(point.tangent.x, point.tangent.z);
    this.vehicle.reset({ x, z, yaw, vLong: 0, vLat: 0, yawRate: 0 });
    this.progressIndex = line.indexAtDistance(distance);
    this.progressDistance = distance;
    this.completed = false;
    this.completedAt = null;
  }

  /** Define the racing line this driver was placed against (used by progress). */
  private sampleStep = 2;

  setSampleStep(step: number): void {
    this.sampleStep = step > 0 ? step : 2;
  }

  /** Advance progress by projecting the car onto the racing line (monotonic). */
  private project(line: RacingLine): { crossTrack: number; tangentForward: Flat; point: RacingLine["points"][number] } {
    const pos = this.position();
    const count = line.points.length;
    const advance = Math.max(8, Math.ceil((this.speed() * (1 / 30) + 8) / this.sampleStep) + 2);
    const from = Math.max(0, this.progressIndex - 2);
    const to = Math.min(count - 1, this.progressIndex + advance);

    let bestIndex = this.progressIndex;
    let bestDist = Infinity;
    for (let i = from; i <= to; i += 1) {
      const p = line.points[i]!;
      const dx = pos.x - p.position.x;
      const dz = pos.z - p.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIndex = i;
      }
    }

    const p = line.points[bestIndex]!;
    const rx = pos.x - p.position.x;
    const rz = pos.z - p.position.z;
    const along = rx * p.tangent.x + rz * p.tangent.z;
    const crossTrack = rx * p.normal.x + rz * p.normal.z;
    const distance = p.distance + along;
    if (distance > this.progressDistance) this.progressDistance = distance;
    this.progressIndex = bestIndex;
    this.lastCenterOffset = p.offset + crossTrack;
    this.lastCurvature = p.curvature;
    return {
      crossTrack,
      tangentForward: { x: p.tangent.x, z: p.tangent.z },
      point: p,
    };
  }

  /**
   * Compute the command for this step. Does **not** advance the vehicle — the
   * race loop owns stepping so it stays in lockstep with surface sampling.
   */
  control(line: RacingLine, surface: Surface, opponents: readonly CpuDriver[]): VehicleInput {
    const state = this.vehicle.getState();
    const speed = this.speed();

    const { crossTrack, point } = this.project(line);
    const finishDistance = line.length;

    if (this.completed || this.progressDistance >= finishDistance - 0.25) {
      // Crossed the line: ease off and steer straight.
      return { throttle: 0, brake: clamp01(speed * 0.15), steer: 0, handbrake: false };
    }

    const forward: Flat = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
    const right: Flat = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };

    // 1. Pure-pursuit steering toward the lookahead point on the line.
    const lookahead = clamp(
      this.tuning.lookaheadBase + this.tuning.lookaheadSpeed * speed,
      this.tuning.lookaheadMin,
      this.tuning.lookaheadMax,
    );
    const target = line.sampleAtDistance(this.progressDistance + lookahead);
    const toX = target.position.x - state.x;
    const toZ = target.position.z - state.z;
    const desiredYaw = Math.atan2(toX, toZ);
    const headingError = wrapAngle(desiredYaw - state.yaw);
    // Cross-track is measured from the racing line; the lane offset is where we
    // want the car to sit, so correct the difference.
    const lineError = crossTrack - this.lineOffset;
    let steer = this.tuning.kHeading * headingError - this.tuning.kCross * lineError;

    // 2. Speed target: the line's feasible speed, scaled by skill. If the car
    //    is running wide of the line, ease off so it does not outrun its grip.
    const widen = clamp(1 - 0.07 * Math.abs(lineError), 0.5, 1);
    // #APEX-27: |lineError| only grows after the car has already left the ideal
    // line, so it reacts too late at the ribbon edge. Ease the target by the
    // car's distance from the CENTRELINE (not just the error to the desired
    // lane) as |centerOffset| approaches half-width.
    const halfWidth = line.halfWidth > 0 ? line.halfWidth : Infinity;
    const edge = halfWidth === Infinity ? 0 : Math.abs(this.lastCenterOffset) / halfWidth;
    const edgeEase = clamp(1 - 0.9 * clamp01((edge - 0.55) / 0.45), 0.25, 1);
    let vTarget = point.targetSpeed * this.skill * widen * edgeEase;
    // Bound the command by what the tyres can actually turn: following the
    // line's curvature PLUS recovering the current cross-track error needs
    // v²·k lateral acceleration. Cap v so that demand stays within grip.
    const grip = Math.max(0.05, surface.lateralGrip);
    const latAccel = grip * 9.81;
    const kReq = Math.abs(point.curvature) + (2 * Math.abs(lineError)) / Math.max(lookahead * lookahead, 1);
    const turnCap = Math.sqrt(latAccel / Math.max(kReq, 1e-4));
    vTarget = Math.min(vTarget, turnCap);

    // 3. Separation / overtake. Iterate a stable order for determinism.
    const opponentsInOrder = [...opponents]
      .filter((o) => o !== this && !o.finished)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const other of opponentsInOrder) {
      const opos = other.position();
      const relX = opos.x - state.x;
      const relZ = opos.z - state.z;
      const along = relX * forward.x + relZ * forward.z;
      const lateral = relX * right.x + relZ * right.z;
      if (along < -1 || along > this.tuning.avoidRange) continue;
      const absLateral = Math.abs(lateral);

      // Longitudinal: only a car roughly in our path blocks us. Desired speed
      // is the follower's speed plus a correction that closes (or opens) the
      // gap toward `minGap`, so we hold a safe distance instead of rear-ending.
      if (absLateral < this.tuning.blockLateral && along > 0.5) {
        const otherSpeed = other.speed();
        const desired = otherSpeed + (along - this.tuning.minGap) * 0.8;
        vTarget = Math.min(vTarget, Math.max(desired, 0));
      }

      // Lateral: steer toward the side with more room. Stronger the closer we
      // are and the more directly the other car is in front of us.
      if (absLateral < this.tuning.avoidLateral && along < this.tuning.minGap + 5) {
        const proximity = 1 - clamp(along / this.tuning.avoidRange, 0, 1);
        const closet = clamp(1 - absLateral / this.tuning.avoidLateral, 0, 1);
        const dir = lateral >= 0 ? -1 : 1;
        steer += dir * this.tuning.overtakeGain * proximity * closet;
      }

      // Emergency separation: never let two cars occupy the same point. If a
      // car is beside us within a car width, brake and steer firmly away.
      if (absLateral < 2.3 && Math.abs(along) < this.tuning.minGap * 0.85) {
        vTarget = Math.min(vTarget, other.speed() * 0.5);
        const dir = lateral >= 0 ? -1 : 1;
        steer += dir * 1.0;
      }
    }

    steer = clamp(steer, -1, 1);

    // 4. Longitudinal control.
    const error = vTarget - speed;
    let throttle = 0;
    let brake = 0;
    if (error > 0.2) {
      throttle = clamp01(error * this.tuning.kThrottle);
    } else if (error < -0.2) {
      brake = clamp01(-error * this.tuning.kBrake);
    } else {
      // Hold speed against drag.
      throttle = point.targetSpeed > 1 ? 0.18 : 0;
    }
    // Guarantee a launch from standstill even if avoidance capped the target.
    if (speed < 4 && vTarget > 2) throttle = Math.max(throttle, 0.7);

    return { throttle, brake, steer, handbrake: false };
  }

  /** Record the finish time once the car has crossed the line. */
  markFinished(time: number): void {
    if (this.completed) return;
    this.completed = true;
    this.completedAt = time;
  }
}
