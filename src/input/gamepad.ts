/**
 * Gamepad → action mapping (#APEX-12).
 *
 * Pure and headless: the caller supplies a `GamepadState` snapshot (the browser's
 * `navigator.getGamepads()` is read at the edge in `manager.ts`). Supports both
 * digital buttons and a signed steering axis with an inner deadzone so a resting
 * stick does not drag the car.
 */
import { neutralActions, type ActionValues } from "./actions";
import { DEFAULT_BINDINGS, type Bindings, type BindingsLike } from "./bindings";

export interface GamepadButtonState {
  pressed: boolean;
  value: number;
}

export interface GamepadState {
  connected: boolean;
  buttons: readonly GamepadButtonState[];
  axes: readonly number[];
}

/** Structural subset of the browser's `Gamepad`. */
export interface GamepadLike {
  connected: boolean;
  buttons: readonly GamepadButtonState[];
  axes: readonly number[];
}

export const DEFAULT_DEADZONE = 0.15;

export interface GamepadOptions {
  /** Axis magnitude below this reads as 0 (default 0.15). */
  deadzone?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Rescale an axis past the deadzone so control resumes smoothly from 0. */
export function applyDeadzone(value: number, deadzone: number): number {
  if (!Number.isFinite(value)) return 0;
  const dz = Math.min(0.95, Math.max(0, deadzone));
  const magnitude = Math.abs(value);
  if (magnitude <= dz) return 0;
  const scaled = (magnitude - dz) / (1 - dz);
  return Math.sign(value) * clamp01(scaled);
}

/** Coerce a browser `Gamepad` (or null) into the small pure snapshot. */
export function toGamepadState(pad: GamepadLike | null | undefined): GamepadState | null {
  if (!pad || !pad.connected) return null;
  return { connected: true, buttons: pad.buttons, axes: pad.axes };
}

function resolve(bindings: BindingsLike): Bindings {
  return typeof bindings === "function" ? bindings() : bindings;
}

/** Project a gamepad snapshot onto action intensities through the binding table. */
export function gamepadToActions(
  state: GamepadState | null | undefined,
  bindings: BindingsLike = DEFAULT_BINDINGS,
  options: GamepadOptions = {},
): ActionValues {
  const values = neutralActions();
  if (!state || !state.connected) return values;
  const deadzone = options.deadzone ?? DEFAULT_DEADZONE;
  const table = resolve(bindings);

  for (const action of Object.keys(table) as (keyof Bindings)[]) {
    for (const binding of table[action]) {
      if (binding.device !== "gamepad") continue;
      if (binding.kind === "axis") {
        const index = Number(binding.code);
        if (!Number.isInteger(index)) continue; // non-numeric axis code
        const magnitude = applyDeadzone(state.axes[index] ?? 0, deadzone);
        if (action === "steerLeft") values.steerLeft = Math.max(values.steerLeft, Math.max(0, -magnitude));
        else if (action === "steerRight") values.steerRight = Math.max(values.steerRight, Math.max(0, magnitude));
        else values[action] = Math.max(values[action], Math.max(0, magnitude));
      } else {
        const index = Number(binding.code);
        if (!Number.isInteger(index)) continue;
        const button = state.buttons[index];
        if (!button) continue;
        const value = button.pressed ? 1 : clamp01(button.value);
        values[action] = Math.max(values[action], value);
      }
    }
  }
  return values;
}

/** Read the first connected pad from a `getGamepads()` snapshot. */
export function firstConnectedGamepad(
  pads: readonly (GamepadLike | null)[] | null | undefined,
): GamepadState | null {
  if (!pads) return null;
  for (const pad of pads) {
    const state = toGamepadState(pad);
    if (state) return state;
  }
  return null;
}
