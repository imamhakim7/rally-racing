/** Keyboard → `VehicleInput` mapping (WASD / arrows / space handbrake). */

import { NEUTRAL_INPUT, type VehicleInput } from "../physics/vehicle";

/** Minimal event-target shape so tests can supply a fake without a DOM. */
export interface KeyboardTarget {
  addEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
}

export interface InputSource {
  /** The command implied by the currently-held keys. */
  read(): VehicleInput;
  dispose(): void;
}

/** Pure mapping from a set of pressed `KeyboardEvent.code`s to a command. */
export function mapKeys(pressed: ReadonlySet<string>): VehicleInput {
  const has = (...codes: string[]): boolean => codes.some((code) => pressed.has(code));
  const steer = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
  return {
    throttle: has("KeyW", "ArrowUp") ? 1 : 0,
    brake: has("KeyS", "ArrowDown") ? 1 : 0,
    steer,
    handbrake: has("Space"),
  };
}

/**
 * Track held keys on `target` and expose them as a `VehicleInput`. Space and the
 * arrow keys are `preventDefault`ed so the page does not scroll while driving.
 */
export function createKeyboardInput(target: KeyboardTarget): InputSource {
  const pressed = new Set<string>();

  const onDown = (event: KeyboardEvent): void => {
    pressed.add(event.code);
    if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
  };
  const onUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
  };
  const onBlur = (): void => {
    pressed.clear();
  };

  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);

  return {
    read: () => (pressed.size === 0 ? { ...NEUTRAL_INPUT } : mapKeys(pressed)),
    dispose: () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
      pressed.clear();
    },
  };
}
