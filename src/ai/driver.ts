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
  /**
   * Fraction of the road half-width at which corner-edge speed easing starts.
   * Below this the car is simply following the line; above it, every extra m/s
   * only widens the excursion.
   */
  edgeEaseStart: number;
  /**
   * Lateral metres from the ribbon edge within which an avoidance/overtake
   * steer command that points *toward* that edge loses authority (0 at the
   * edge, full at `edgeGuardBand`). Containment must beat car-to-car spacing:
   * a car pushed over the edge fails the stage contract for every car behind it.
   */
  edgeGuardBand: number;
  /** Depth of the corner-edge speed easing (fraction of the target speed). */
  edgeEaseDepth: number;
  /** Speed penalty per metre the car is off its line. */
  widenGain: number;
  /** Centreline fraction from which a *drifting* car starts shedding speed. */
  recoveryEdgeStart: number;
  /** Heading (rad) off the road tangent that counts as drifting toward the edge. */
  recoveryHeading: number;
  /** Steering authority (|steer|) above which the recovery brake is armed. */
  recoverySteerStart: number;
  /** Brake command applied while recovering toward the ribbon edge. */
  recoveryBrake: number;
  /** Largest temporary lane shift (m) pure pursuit uses to open a gap to a car beside us. */
  separationAim: number;
  /** Lateral band (m) inside which the separation aim is active. Wider than the brake band. */
  aimLateral: number;
  /** Lateral band (m) inside which the emergency separation rule applies. */
  emergencyLateral: number;
  /** Speed target (as a factor of the other car) inside the emergency band. */
  emergencyBrake: number;
}

/**
 * #APEX-31: clearance (m) a separation aim keeps from the ribbon edge. The aim
 * point may never be placed closer than this, so opening a gap can never point
 * the car off the road.
 */
const EDGE_MARGIN = 0.4;

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
  edgeEaseStart: 0.7,
  edgeEaseDepth: 0.65,
  widenGain: 0.1,
  edgeGuardBand: 2.5,
  recoveryEdgeStart: 0.4,
  recoveryHeading: 0.08,
  recoverySteerStart: 0.8,
  recoveryBrake: 1,
  separationAim: 1.6,
  aimLateral: 3.5,
  emergencyLateral: 2.52,
  emergencyBrake: 0.5,
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
  /**
   * #APEX-8 bounded catch-up multiplier applied to the target speed. Default `1`
   * (no change); see {@link setCatchUp}. It only ever scales a *command*, never a
   * position or velocity, so it cannot teleport the car.
   */
  private catchUpFactor = 1;

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

  /** Current bounded catch-up multiplier (1 = none). */
  get catchUp(): number {
    return this.catchUpFactor;
  }

  /**
   * Set the bounded catch-up multiplier applied to the target speed this step.
   * Guarded so a bad value can never produce a non-finite or absurd command: the
   * factor is clamped to `[0.5, 2]` and a non-finite input resets to `1`.
   */
  setCatchUp(factor: number): void {
    this.catchUpFactor = Number.isFinite(factor) ? clamp(factor, 0.5, 2) : 1;
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

  /**
   * Re-project the car onto the racing line, refreshing `centerOffset`,
   * `curvature` and arc progress. The race loop calls this after stepping the
   * vehicle (and after any containment correction) so the on-ribbon telemetry
   * reflects the car's true position.
   */
  refreshProgress(line: RacingLine): void {
    this.project(line);
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
    const halfWidthForAim = line.halfWidth > 0 ? line.halfWidth : Infinity;
    // #APEX-31: a car beside us gets a temporary shift of the *aim point* away
    // from it. A steering nudge alone cannot open the gap when both cars are at
    // the grip limit in a bend — the away component saturates against the corner
    // demand — and braking both cars keeps them glued together. Moving what the
    // car pursues lets it find the room over a second or two instead.
    let separationAim = 0;
    for (const other of opponents) {
      if (other === this || other.finished) continue;
      const opos = other.position();
      const relX = opos.x - state.x;
      const relZ = opos.z - state.z;
      const along = relX * forward.x + relZ * forward.z;
      const lateral = relX * right.x + relZ * right.z;
      const absLateral = Math.abs(lateral);
      if (
        absLateral >= this.tuning.aimLateral ||
        Math.abs(along) >= this.tuning.minGap * 0.85
      ) {
        continue;
      }
      const room = this.tuning.aimLateral - absLateral;
      const dir = lateral >= 0 ? -1 : 1;
      // An aim pointing at the near ribbon edge has nowhere to go: cap it by the
      // room left beyond the edge guard band. A partial aim still walks the car
      // outward on every step and ends 0.3 m past the ribbon at 7 m/s
      // (coastal-cliffs seed 1003), so the band is a hard floor, not a taper.
      const spaceToEdge =
        halfWidthForAim === Infinity
          ? Infinity
          : halfWidthForAim - Math.abs(this.lastCenterOffset);
      const towardEdge = dir * Math.sign(this.lastCenterOffset || 1) > 0;
      const allowed = towardEdge
        ? Math.max(0, spaceToEdge - this.tuning.edgeGuardBand)
        : Infinity;
      separationAim += dir * Math.min(this.tuning.separationAim, room, allowed);
    }
    separationAim = clamp(separationAim, -this.tuning.separationAim, this.tuning.separationAim);

    // Shift the pursuit target by the aim, clamped so the requested point always
    // sits inside the ribbon (belt and braces next to the edge-guard cap above).
    const target = line.sampleAtDistance(this.progressDistance + lookahead);
    const laneTarget = clamp(
      target.offset + separationAim,
      -(halfWidthForAim - EDGE_MARGIN),
      halfWidthForAim - EDGE_MARGIN,
    );
    const laneShift = laneTarget - target.offset;
    const toX = target.position.x + target.normal.x * laneShift - state.x;
    const toZ = target.position.z + target.normal.z * laneShift - state.z;
    const desiredYaw = Math.atan2(toX, toZ);
    const headingError = wrapAngle(desiredYaw - state.yaw);
    // Cross-track is measured from the racing line; the lane offset is where we
    // want the car to sit, so correct the difference.
    const lineError = crossTrack - this.lineOffset;
    let steer = this.tuning.kHeading * headingError - this.tuning.kCross * lineError;

    // Containment first: the ribbon edge is a hard limit and an avoidance
    // command must never overrule it (#APEX-27).
    const halfWidth = line.halfWidth > 0 ? line.halfWidth : Infinity;
    /**
     * Scale a steer command that pushes *toward* the near edge by the room left
     * on that side. Steering away from it (recovering) keeps full authority.
     */
    const edgeGuard = (delta: number): number => {
      if (!(halfWidth > 0) || delta === 0) return delta;
      const room = delta > 0 ? halfWidth - this.lastCenterOffset : halfWidth + this.lastCenterOffset;
      return delta * clamp01(room / this.tuning.edgeGuardBand);
    };

    // 2. Speed target: the line's feasible speed, scaled by skill. If the car
    //    is running wide of the line, ease off so it does not outrun its grip.
    const widen = clamp(1 - this.tuning.widenGain * Math.abs(lineError), 0.4, 1);
    // #APEX-27: |lineError| only grows after the car has already left the ideal
    // line, so it reacts too late at the ribbon edge. Ease the target by the
    // car's distance from the CENTRELINE (not just the error to the desired
    // lane) as |centerOffset| approaches half-width. The easing starts late
    // (`edgeEaseStart`) so a normal wide line keeps its lap time — the original
    // 0.55 start cost 2.4 s on `mountain-pass` seed 9 and broke the finish
    // window (#APEX-31).
    const edge = halfWidth === Infinity ? 0 : Math.abs(this.lastCenterOffset) / halfWidth;
    const edgeWindow = Math.max(1 - this.tuning.edgeEaseStart, 1e-6);
    const edgeEase = clamp(
      1 - this.tuning.edgeEaseDepth * clamp01((edge - this.tuning.edgeEaseStart) / edgeWindow),
      1 - this.tuning.edgeEaseDepth,
      1,
    );
    let vTarget = point.targetSpeed * this.skill * this.catchUpFactor * widen * edgeEase;
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
        steer += edgeGuard(dir * this.tuning.overtakeGain * proximity * closet);
      }

      // Emergency separation: never let two cars occupy the same point. If a
      // car is beside us within a car width, brake and steer firmly away.
      // Yielding asymmetrically (only the car behind brakes) looked plausible
      // but measured worse: 39/1800 races under 2 m instead of 26, because the
      // leader's extra speed is what drags the pair together through the bend.
      if (absLateral < this.tuning.emergencyLateral && Math.abs(along) < this.tuning.minGap * 0.85) {
        vTarget = Math.min(vTarget, other.speed() * this.tuning.emergencyBrake);
        const dir = lateral >= 0 ? -1 : 1;
        steer += edgeGuard(dir * 1.0);
      }
    }

    steer = clamp(steer, -1, 1);

    // #APEX-27/#APEX-31: a car commanding (nearly) full steering lock while it
    // is already close to the ribbon edge has lost the geometry — more steering
    // cannot help, and the road-wheel angle falls off with speed, so shedding
    // speed is the only way back inside. Gate the brake on *saturation* so a
    // wide-but-controllable line keeps its lap time; a flat speed cut from 55 %
    // of half-width cost 2.4 s on `mountain-pass` seed 9 and broke the window.
    // Only brake when the car is *sliding toward* that edge: its heading is off
    // the road tangent on the edge's side, or it is already beyond the ribbon.
    const side = this.lastCenterOffset >= 0 ? 1 : -1;
    const tangentYaw = Math.atan2(point.tangent.x, point.tangent.z);
    const drift = edge >= 1 ? 1 : clamp01((wrapAngle(state.yaw - tangentYaw) * side) / this.tuning.recoveryHeading);
    const nearEdge = clamp01((edge - this.tuning.recoveryEdgeStart) / Math.max(1 - this.tuning.recoveryEdgeStart, 1e-6));
    const atLimit = clamp01((Math.abs(steer) - this.tuning.recoverySteerStart) / Math.max(1 - this.tuning.recoverySteerStart, 1e-6));
    const recovery = nearEdge * drift * atLimit;

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
    if (recovery > 0) {
      throttle = 0;
      brake = Math.max(brake, this.tuning.recoveryBrake * clamp01(0.3 + 0.7 * recovery));
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
