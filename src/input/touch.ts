/**
 * Touch → `VehicleInput` mapping (#APEX-12).
 *
 * The DOM on-screen control (`src/ui/touchControls.ts`) normalises pointer input
 * into a `TouchPad`; this pure projection turns it into the physics command so the
 * mapping is unit-testable without a DOM.
 */
import type { VehicleInput } from "../physics/vehicle";

export interface TouchPad {
  /** Steering, −1 (left) .. 1 (right). */
  steer: number;
  /** Throttle, 0..1. */
  throttle: number;
  /** Brake / reverse, 0..1. */
  brake: number;
  handbrake: boolean;
}

export const NEUTRAL_TOUCH_PAD: TouchPad = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Normalise a raw pointer offset (dx from centre) into steering −1..1. */
export function steerFromOffset(dx: number, radius: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(radius) || radius <= 0) return 0;
  return Math.min(1, Math.max(-1, dx / radius));
}

export function touchPadToInput(pad: TouchPad): VehicleInput {
  return {
    throttle: clamp01(pad.throttle),
    brake: clamp01(pad.brake),
    steer: Math.min(1, Math.max(-1, Number.isFinite(pad.steer) ? pad.steer : 0)),
    handbrake: !!pad.handbrake,
  };
}
