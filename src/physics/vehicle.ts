/**
 * Arcade rally vehicle model.
 *
 * A single-track ("bicycle") model with a simplified-Pacejka tyre curve
 * (`pacejka.ts`). The state is integrated in the body frame at a fixed step so
 * the whole game is frame-rate independent: identical inputs over identical
 * simulated time produce the identical path whether the display runs at 30, 60
 * or 144 fps (that is exactly what `tests/framerate.test.ts` asserts).
 *
 * Body axes: `vLong` is forward (+), `vLat` is to the car's right (+). Heading
 * `yaw` maps body → world as forward `(sin yaw, cos yaw)`, right
 * `(cos yaw, -sin yaw)`.
 *
 * Forces per step:
 *   - longitudinal: engine/brake/rolling resistance, scaled by surface grip
 *   - lateral:       simplified Pacejka per axle, scaled by surface grip and
 *                    the static axle load; the handbrake cuts rear grip so the
 *                    tail steps out into a controllable drift
 *   - yaw moment:    front lateral force × front arm − rear lateral force × rear arm
 */

import { pacejka } from "./pacejka";
import type { Surface } from "./surface";
import { clamp, clamp01, damp } from "./util";

export interface VehicleConfig {
  /** Mass (kg). */
  mass: number;
  /** Yaw moment of inertia (kg·m²). */
  inertia: number;
  /** Front axle to centre of gravity (m). */
  frontAxleDistance: number;
  /** Rear axle to centre of gravity (m). */
  rearAxleDistance: number;
  /** Peak engine force at zero speed (N). */
  maxEngineForce: number;
  /** Peak reverse force (N). */
  maxReverseForce: number;
  /** Peak brake force applied against the current motion (N). */
  maxBrakeForce: number;
  /** Speed above which the engine stops adding force (m/s). */
  maxSpeed: number;
  /** Maximum road-wheel steer angle at standstill (rad). */
  maxSteerAngle: number;
  /** Steer-angle falloff with speed (s/m): factor = 1 / (1 + falloff·speed). */
  steerSpeedFalloff: number;
  /** How fast the road wheels move toward the commanded angle (rad/s). */
  steerRate: number;
  /** Pacejka stiffness (B) for the tyres. */
  tyreStiffness: number;
  /** Pacejka shape (C) for the tyres. */
  tyreShape: number;
  /** Rear lateral grip multiplier while the handbrake is pulled (0..1). */
  handbrakeGrip: number;
  /** Extra rear longitudinal drag while the handbrake is pulled (N). */
  handbrakeForce: number;
  /** Yaw-rate damping (1/s). Stands in for tyre relaxation and keeps a drift
   *  recoverable instead of spinning the car. */
  yawDamping: number;
  /** Extra lateral-velocity bleed while sliding (1/s); 0 disables it. */
  lateralDamping: number;
  /** Aerodynamic drag coefficient (N per (m/s)²). */
  dragCoefficient: number;
  /** Below this speed the model is treated as (nearly) stationary (m/s). */
  lowSpeed: number;
  /** Body slip angle above which the car is reported as drifting (rad). */
  driftThreshold: number;
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  mass: 1200,
  inertia: 1500,
  frontAxleDistance: 1.3,
  rearAxleDistance: 1.3,
  maxEngineForce: 9000,
  maxReverseForce: 4200,
  maxBrakeForce: 12000,
  maxSpeed: 52,
  maxSteerAngle: 0.55,
  steerSpeedFalloff: 0.045,
  steerRate: 5.5,
  tyreStiffness: 9,
  tyreShape: 1.6,
  handbrakeGrip: 0.42,
  handbrakeForce: 2600,
  yawDamping: 1.4,
  lateralDamping: 0.6,
  dragCoefficient: 0.42,
  lowSpeed: 2.5,
  driftThreshold: 0.18,
};

/** Driver command for one fixed step. All fields are optional and clamped. */
export interface VehicleInput {
  /** Forward drive, 0..1. */
  throttle: number;
  /** Brake / reverse, 0..1. */
  brake: number;
  /** Steering, -1 (full left) .. 1 (full right). */
  steer: number;
  /** Handbrake engaged. */
  handbrake: boolean;
}

export const NEUTRAL_INPUT: VehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
};

export interface VehicleState {
  x: number;
  z: number;
  yaw: number;
  /** Forward (body +x) velocity, m/s. */
  vLong: number;
  /** Lateral (body +y, to the right) velocity, m/s. */
  vLat: number;
  /** Yaw rate, rad/s. */
  yawRate: number;
}

export interface VehicleTelemetry {
  /** Speed magnitude, m/s. */
  speed: number;
  /** Speed magnitude, km/h. */
  speedKmh: number;
  /** Signed forward speed, m/s. */
  forwardSpeed: number;
  /** Signed lateral speed (positive = sliding right), m/s. */
  lateralSpeed: number;
  /** Centre-of-gravity slip angle, rad. */
  slipAngle: number;
  /** Front axle slip angle, rad. */
  slipAngleFront: number;
  /** Rear axle slip angle, rad. */
  slipAngleRear: number;
  /** Applied road-wheel steer angle (speed-sensitive), rad. */
  steerAngle: number;
  /** Yaw rate, rad/s. */
  yawRate: number;
  /** True when the handbrake is pulled or the body slip exceeds the threshold. */
  drifting: boolean;
}

const GRAVITY = 9.81;

function normaliseInput(input: VehicleInput): VehicleInput {
  return {
    throttle: clamp01(input.throttle),
    brake: clamp01(input.brake),
    steer: clamp(input.steer, -1, 1),
    handbrake: !!input.handbrake,
  };
}

export class Vehicle {
  readonly config: VehicleConfig;

  private state: VehicleState = { x: 0, z: 0, yaw: 0, vLong: 0, vLat: 0, yawRate: 0 };
  private steerAngle = 0;
  private slipFront = 0;
  private slipRear = 0;
  private drift = false;

  constructor(config: Partial<VehicleConfig> = {}) {
    this.config = { ...DEFAULT_VEHICLE_CONFIG, ...config };
    if (!(this.config.mass > 0)) throw new Error("vehicle mass must be > 0");
    if (!(this.config.inertia > 0)) throw new Error("vehicle inertia must be > 0");
    const wheelBase = this.config.frontAxleDistance + this.config.rearAxleDistance;
    if (!(wheelBase > 0)) throw new Error("vehicle wheelbase must be > 0");
  }

  get wheelBase(): number {
    return this.config.frontAxleDistance + this.config.rearAxleDistance;
  }

  /** Live state (copy — mutate through `setState`/`reset`). */
  getState(): VehicleState {
    return { ...this.state };
  }

  setState(partial: Partial<VehicleState>): void {
    this.state = { ...this.state, ...partial };
  }

  reset(state: Partial<VehicleState> = {}): void {
    this.state = { x: 0, z: 0, yaw: 0, vLong: 0, vLat: 0, yawRate: 0, ...state };
    this.steerAngle = 0;
    this.slipFront = 0;
    this.slipRear = 0;
    this.drift = false;
  }

  /**
   * The road-wheel steer angle this input and speed produce *before* steering
   * rate limiting. Speed-sensitive: the faster the car, the smaller the angle,
   * so high-speed steering is calmer.
   */
  computeSteerAngle(steerInput: number, speed: number): number {
    const factor = 1 / (1 + this.config.steerSpeedFalloff * Math.max(speed, 0));
    return this.config.maxSteerAngle * clamp(steerInput, -1, 1) * factor;
  }

  /** Telemetry for the debug overlay. */
  telemetry(): VehicleTelemetry {
    const { vLong, vLat, yawRate } = this.state;
    const speed = Math.hypot(vLong, vLat);
    const slipAngle = Math.atan2(vLat, Math.abs(vLong) < 1e-6 ? 1e-6 : vLong);
    return {
      speed,
      speedKmh: speed * 3.6,
      forwardSpeed: vLong,
      lateralSpeed: vLat,
      slipAngle,
      slipAngleFront: this.slipFront,
      slipAngleRear: this.slipRear,
      steerAngle: this.steerAngle,
      yawRate,
      drifting: this.drift,
    };
  }

  /**
   * Advance the vehicle by `dt` seconds on `surface`. Pure with respect to the
   * clock — the only time source is `dt`, so the same input sequence always
   * yields the same trajectory.
   */
  step(rawInput: VehicleInput, dt: number, surface: Surface): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const input = normaliseInput(rawInput);
    const c = this.config;
    const s = this.state;

    const speed = Math.hypot(s.vLong, s.vLat);

    // 1. Steering: rate-limited toward the speed-sensitive target.
    const target = this.computeSteerAngle(input.steer, speed);
    const maxDelta = c.steerRate * dt;
    const steerDelta = clamp(target - this.steerAngle, -maxDelta, maxDelta);
    this.steerAngle += steerDelta;
    const steerAngle = this.steerAngle;

    // 2. Longitudinal demand: throttle forward, brake back/reverse. The brake
    //    opposes motion first and, once the car is (nearly) stopped, drives it
    //    in reverse — so one axis covers braking *and* reversing.
    const throttle = input.throttle;
    const brake = input.brake;
    const driveDemand = throttle - brake;
    const grip = surface.longitudinalGrip;
    const speedLimiter = 1 - clamp(Math.abs(s.vLong) / c.maxSpeed, 0, 1);
    let longForce = 0;
    if (speed > c.lowSpeed) {
      // Moving: throttle drives (tapering to zero at max speed), brake
      // decelerates against the direction of travel. Both scale with grip.
      longForce += throttle * c.maxEngineForce * grip * speedLimiter;
      longForce -= brake * c.maxBrakeForce * grip * Math.sign(s.vLong);
    } else if (driveDemand >= 0) {
      longForce += driveDemand * c.maxEngineForce * grip;
    } else {
      longForce += driveDemand * c.maxReverseForce * grip;
    }
    if (input.handbrake) longForce -= Math.sign(s.vLong) * c.handbrakeForce;

    // 3. Slip angles (guard the low-speed singularity).
    const absLong = Math.max(Math.abs(s.vLong), c.lowSpeed);
    const slipFront = Math.atan2(s.vLat + s.yawRate * c.frontAxleDistance, absLong) - steerAngle;
    const slipRear = Math.atan2(s.vLat - s.yawRate * c.rearAxleDistance, absLong);
    this.slipFront = slipFront;
    this.slipRear = slipRear;

    // 4. Lateral tyre forces. Peak scales with surface grip and static axle load.
    const weightFront = c.rearAxleDistance / this.wheelBase;
    const weightRear = 1 - weightFront;
    const rearGrip = surface.lateralGrip * (input.handbrake ? c.handbrakeGrip : 1);
    const lateralPeakFront = surface.lateralGrip * c.mass * GRAVITY * weightFront;
    const lateralPeakRear = rearGrip * c.mass * GRAVITY * weightRear;
    const forceFront = -pacejka(slipFront, {
      peak: lateralPeakFront,
      stiffness: c.tyreStiffness,
      shape: c.tyreShape,
    });
    const forceRear = -pacejka(slipRear, {
      peak: lateralPeakRear,
      stiffness: c.tyreStiffness,
      shape: c.tyreShape,
    });
    const lateralForce = forceFront * Math.cos(steerAngle) + forceRear;

    // 5. Body-frame accelerations (include the rotating-frame coupling terms).
    const mass = c.mass;
    const ax = longForce / mass + s.yawRate * s.vLat;
    const ay = lateralForce / mass - s.yawRate * s.vLong;

    // 6. Yaw moment from the two axle forces.
    const yawMoment =
      c.frontAxleDistance * forceFront * Math.cos(steerAngle) -
      c.rearAxleDistance * forceRear;
    const angularAccel = yawMoment / c.inertia;

    s.vLong += ax * dt;
    s.vLat += ay * dt;
    s.yawRate += angularAccel * dt;

    // 7. Rolling resistance + aerodynamic drag (both oppose motion).
    const rolling = surface.rollingResistance * mass * s.vLong;
    const drag = c.dragCoefficient * s.vLong * Math.abs(s.vLong);
    s.vLong -= ((rolling + drag) / mass) * dt;

    // 7b. Tyre relaxation / stabilisation. Yaw damping keeps a drift from
    //     turning into an unrecoverable spin; extra lateral bleed only applies
    //     once the handbrake is released, so the tail can still step out.
    s.yawRate *= 1 - damp(c.yawDamping, dt);
    if (!input.handbrake) {
      s.vLat *= 1 - damp(c.lateralDamping, dt);
    }

    // 8. Kill the low-speed jitter that an arcade model accumulates at rest.
    if (speed < c.lowSpeed && Math.abs(driveDemand) < 1e-3 && !input.handbrake) {
      s.vLong *= 0.5;
      s.vLat *= 0.5;
      s.yawRate *= 0.5;
    }

    // 9. Integrate heading, then map body velocity to world and integrate pose.
    s.yaw += s.yawRate * dt;
    const sinYaw = Math.sin(s.yaw);
    const cosYaw = Math.cos(s.yaw);
    s.x += (s.vLong * sinYaw + s.vLat * cosYaw) * dt;
    s.z += (s.vLong * cosYaw - s.vLat * sinYaw) * dt;

    const bodySlip = Math.abs(s.vLat) > 1e-6 ? Math.atan2(s.vLat, Math.abs(s.vLong)) : 0;
    this.drift = input.handbrake || Math.abs(bodySlip) > c.driftThreshold;
  }
}
