/**
 * Input manager (#APEX-12): merges keyboard, gamepad and touch into one command.
 *
 * The browser/platform APIs are injected (`keyboardTarget`, `gamepadState`), so
 * the manager is exercised headlessly with fakes. It owns the live binding table:
 * remapping is a `setBindings` call and every source picks it up immediately.
 */
import { NEUTRAL_INPUT, type VehicleInput } from "../physics/vehicle";
import { actionsToVehicleInput } from "./actions";
import { DEFAULT_BINDINGS, normalizeBindings, type Bindings } from "./bindings";
import {
  firstConnectedGamepad,
  gamepadToActions,
  type GamepadLike,
  type GamepadState,
} from "./gamepad";
import { createKeyboardInput, type InputSource, type KeyboardTarget } from "./keyboard";

export type ActiveDevice = "keyboard" | "gamepad" | "touch" | "none";

export interface GamepadStateSource {
  (): GamepadState | null;
}

export interface InputManagerOptions {
  bindings?: Bindings;
  /** Keyboard event target; defaults to `window` when available, `null` disables it. */
  keyboardTarget?: KeyboardTarget | null;
  /** Gamepad snapshot source; defaults to `navigator.getGamepads()`. */
  gamepadState?: GamepadStateSource;
  /** Touch source (on-screen controls). */
  touch?: InputSource | null;
  deadzone?: number;
}

export interface InputManager extends InputSource {
  readonly activeDevice: ActiveDevice;
  getBindings(): Bindings;
  setBindings(bindings: Bindings): void;
}

export function isNeutralInput(input: VehicleInput): boolean {
  return input.throttle === 0 && input.brake === 0 && input.steer === 0 && !input.handbrake;
}

/** Merge commands from several devices: max drive, steering by largest magnitude. */
export function mergeVehicleInputs(inputs: readonly VehicleInput[]): VehicleInput {
  let throttle = 0;
  let brake = 0;
  let handbrake = false;
  let steer = 0;
  for (const input of inputs) {
    throttle = Math.max(throttle, input.throttle);
    brake = Math.max(brake, input.brake);
    handbrake = handbrake || input.handbrake;
    if (Math.abs(input.steer) > Math.abs(steer)) steer = input.steer;
  }
  return { throttle, brake, steer, handbrake };
}

function navigatorGamepadState(): GamepadState | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return null;
  }
  try {
    return firstConnectedGamepad(navigator.getGamepads() as unknown as (GamepadLike | null)[]);
  } catch {
    return null;
  }
}

/**
 * Compose an `InputManager`. With no options it reads the keyboard (window) and
 * the first connected gamepad; touch is opt-in via `options.touch`.
 */
export function createInputManager(options: InputManagerOptions = {}): InputManager {
  let bindings = normalizeBindings(options.bindings ?? DEFAULT_BINDINGS);
  const deadzone = options.deadzone ?? undefined;

  let keyboard: InputSource | null = null;
  if (options.keyboardTarget !== null) {
    const target =
      options.keyboardTarget ??
      (typeof window !== "undefined" ? (window as unknown as KeyboardTarget) : null);
    if (target) keyboard = createKeyboardInput(target, () => bindings);
  }

  const gamepadSource = options.gamepadState ?? navigatorGamepadState;
  const touch = options.touch ?? null;

  let active: ActiveDevice = "none";

  return {
    get activeDevice() {
      return active;
    },
    getBindings: () => bindings,
    setBindings: (next) => {
      bindings = normalizeBindings(next);
    },
    read: () => {
      const keyboardInput = keyboard ? keyboard.read() : NEUTRAL_INPUT;
      const gamepadInput = actionsToVehicleInput(
        gamepadToActions(gamepadSource(), bindings, deadzone === undefined ? {} : { deadzone }),
      );
      const touchInput = touch ? touch.read() : NEUTRAL_INPUT;

      const keyboardActive = !isNeutralInput(keyboardInput);
      const gamepadActive = !isNeutralInput(gamepadInput);
      const touchActive = !isNeutralInput(touchInput);
      if (touchActive) active = "touch";
      else if (gamepadActive) active = "gamepad";
      else if (keyboardActive) active = "keyboard";

      return mergeVehicleInputs([keyboardInput, gamepadInput, touchInput]);
    },
    dispose: () => {
      keyboard?.dispose();
      keyboard = null;
      touch?.dispose();
    },
  };
}
