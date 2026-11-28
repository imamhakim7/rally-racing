/**
 * Motion policy (#APEX-12).
 *
 * Reduced motion is enforced here, as a *policy* — not only as a CSS media query —
 * so scene effects (camera shake, motion blur) cannot ignore it. `cameraMotion`
 * returns zeroes whenever the policy is reduced, and `shakeOffset` is a pure,
 * deterministic offset so it is unit-testable.
 */
import type { ReducedMotionPreference } from "../input/settings";

export type MotionState = "full" | "reduced";

export interface MotionPolicy {
  reduced: boolean;
}

export const FULL_MOTION: MotionPolicy = { reduced: false };
export const REDUCED_MOTION: MotionPolicy = { reduced: true };

/** Resolve the user preference + OS flag into a motion state. */
export function resolveMotionState(
  preference: ReducedMotionPreference,
  systemReducedMotion: boolean,
): MotionState {
  if (preference === "on") return "reduced";
  if (preference === "off") return "full";
  return systemReducedMotion ? "reduced" : "full";
}

export function motionPolicy(state: MotionState): MotionPolicy {
  return { reduced: state === "reduced" };
}

export interface CameraMotion {
  /** Shake amplitude (world units); 0 when reduced. */
  shake: number;
  /** Blur strength (px); 0 when reduced. */
  blur: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Camera motion at a given speed (0..1 of the reference top speed). Both effects
 * are zero under a reduced policy, regardless of speed.
 */
export function cameraMotion(policy: MotionPolicy, speedRatio: number): CameraMotion {
  if (policy.reduced) return { shake: 0, blur: 0 };
  const t = clamp01(speedRatio);
  const eased = t * t; // feel ramps in at speed
  return { shake: 0.28 * eased, blur: 2.4 * eased };
}

/** Deterministic pseudo-noise offset for a shake at `timeSec`. */
export function shakeOffset(
  timeSec: number,
  amplitude: number,
  seed = 1,
): { x: number; y: number } {
  if (!(amplitude > 0) || !Number.isFinite(amplitude)) return { x: 0, y: 0 };
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  return {
    x: Math.sin(t * 37.1 + seed * 1.7) * amplitude,
    y: Math.sin(t * 43.7 + seed * 2.3) * amplitude * 0.6,
  };
}
