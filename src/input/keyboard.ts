/** Keyboard → `VehicleInput` mapping, driven by the remappable binding table. */

import { NEUTRAL_INPUT, type VehicleInput } from "../physics/vehicle";
import { actionsToVehicleInput, neutralActions, type ActionValues } from "./actions";
import { DEFAULT_BINDINGS, type Bindings, type BindingsLike } from "./bindings";

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

function resolveBindings(bindings: BindingsLike): Bindings {
  return typeof bindings === "function" ? bindings() : bindings;
}

/** Pure mapping from a set of pressed `KeyboardEvent.code`s to action intensities. */
export function mapKeysToActions(
  pressed: ReadonlySet<string>,
  bindings: BindingsLike = DEFAULT_BINDINGS,
): ActionValues {
  const table = resolveBindings(bindings);
  const values = neutralActions();
  for (const action of Object.keys(table) as (keyof Bindings)[]) {
    for (const binding of table[action]) {
      if (binding.device !== "keyboard" || !pressed.has(binding.code)) continue;
      values[action] = 1;
    }
  }
  return values;
}

/** Pure mapping from pressed keys to a vehicle command (default table preserves #APEX-10 keys). */
export function mapKeys(
  pressed: ReadonlySet<string>,
  bindings: BindingsLike = DEFAULT_BINDINGS,
): VehicleInput {
  return actionsToVehicleInput(mapKeysToActions(pressed, bindings));
}

/**
 * Track held keys on `target` and expose them as a `VehicleInput`, resolved
 * through `bindings` (a getter lets the manager swap bindings live). Space and the
 * arrow keys are `preventDefault`ed so the page does not scroll while driving.
 */
export function createKeyboardInput(
  target: KeyboardTarget,
  bindings: BindingsLike = DEFAULT_BINDINGS,
): InputSource {
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
    read: () => (pressed.size === 0 ? { ...NEUTRAL_INPUT } : mapKeys(pressed, bindings)),
    dispose: () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
      pressed.clear();
    },
  };
}
