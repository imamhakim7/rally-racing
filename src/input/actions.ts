/**
 * The input abstraction's vocabulary (#APEX-12).
 *
 * A physical control (key, gamepad button/axis, touch zone) maps to one of five
 * *actions*. Each action carries an intensity in `0..1`, so digital keys and
 * analog sticks resolve to the same shape and can be merged. `actionsToVehicleInput`
 * is the single place that turns that shape into the physics model's `VehicleInput`
 * (#APEX-2), so every source drives the car identically.
 */
import type { VehicleInput } from "../physics/vehicle";

export type InputAction = "throttle" | "brake" | "steerLeft" | "steerRight" | "handbrake";

/** Stable order for iteration, UI and tests. */
export const INPUT_ACTIONS: readonly InputAction[] = [
  "throttle",
  "brake",
  "steerLeft",
  "steerRight",
  "handbrake",
];

/** Intensity 0..1 for every action. */
export type ActionValues = Record<InputAction, number>;

export const ACTION_LABELS: Record<InputAction, string> = {
  throttle: "Accelerate",
  brake: "Brake / reverse",
  steerLeft: "Steer left",
  steerRight: "Steer right",
  handbrake: "Handbrake",
};

export const NEUTRAL_ACTIONS: ActionValues = {
  throttle: 0,
  brake: 0,
  steerLeft: 0,
  steerRight: 0,
  handbrake: 0,
};

export function neutralActions(): ActionValues {
  return { ...NEUTRAL_ACTIONS };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Project action intensities onto the physics command. Steer is right − left. */
export function actionsToVehicleInput(values: ActionValues): VehicleInput {
  const steer = clamp01(values.steerRight) - clamp01(values.steerLeft);
  return {
    throttle: clamp01(values.throttle),
    brake: clamp01(values.brake),
    steer: Math.min(1, Math.max(-1, steer)),
    handbrake: values.handbrake > 0.5,
  };
}
