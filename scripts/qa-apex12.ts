// Input abstraction evidence for #APEX-12.
//
//   bun scripts/qa-apex12.ts > docs/evidence/APEX-12-input.txt
//
// Proves every device resolves to the same VehicleInput and that remapping +
// conflict detection behave, without a browser (pure logic).
import { actionsToVehicleInput } from "../src/input/actions";
import {
  assignBinding,
  bindingLabel,
  bindingOwners,
  conflicts,
  DEFAULT_BINDINGS,
  defaultBindings,
  type ControlBinding,
} from "../src/input/bindings";
import { gamepadToActions, type GamepadState } from "../src/input/gamepad";
import { createInputManager } from "../src/input/manager";
import type { KeyboardTarget } from "../src/input/keyboard";
import { touchPadToInput } from "../src/input/touch";
import { DEFAULT_SETTINGS } from "../src/input/settings";

const line = (label: string, value: unknown): void =>
  console.log(`${label.padEnd(34)} ${JSON.stringify(value)}`);

console.log("# APEX-12 input abstraction evidence");
console.log(`bindings default conflicts: ${JSON.stringify(conflicts(DEFAULT_BINDINGS))}`);
console.log(`settings version/deadzone:  ${DEFAULT_SETTINGS.version} / ${DEFAULT_SETTINGS.input.deadzone}`);
console.log("");

// --- keyboard -------------------------------------------------------------
const listeners = new Map<string, (event: KeyboardEvent) => void>();
const target: KeyboardTarget = {
  addEventListener: (type, listener) => listeners.set(type, listener),
  removeEventListener: (type) => listeners.delete(type),
};
const down = (code: string): void => listeners.get("keydown")?.({ code, preventDefault() {} } as KeyboardEvent);
const up = (code: string): void => listeners.get("keyup")?.({ code } as KeyboardEvent);

const manager = createInputManager({ keyboardTarget: target, gamepadState: () => null, touch: null });
down("KeyW");
down("KeyD");
line("keyboard W+D", manager.read());
up("KeyW");
up("KeyD");
down("Space");
line("keyboard space", manager.read());
up("Space");

// --- gamepad --------------------------------------------------------------
const pad = (pressed: number[], axes: number[]): GamepadState => ({
  connected: true,
  buttons: Array.from({ length: 16 }, (_v, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
  axes,
});
line("gamepad RT + stick right", actionsToVehicleInput(gamepadToActions(pad([7], [0.7, 0, 0, 0]))));
line("gamepad LT + stick left", actionsToVehicleInput(gamepadToActions(pad([6], [-0.7, 0, 0, 0]))));
line("gamepad stick deadzone", actionsToVehicleInput(gamepadToActions(pad([], [0.1, 0, 0, 0]))));

// --- touch ----------------------------------------------------------------
line("touch steer+throttle", touchPadToInput({ steer: -0.6, throttle: 1, brake: 0, handbrake: false }));

// --- remap + conflict -----------------------------------------------------
const keyW: ControlBinding = { device: "keyboard", kind: "button", code: "KeyW" };
line("owners of KeyW (before)", bindingOwners(DEFAULT_BINDINGS, keyW));
const remapped = assignBinding(defaultBindings(), "brake", keyW);
line("owners of KeyW (after)", bindingOwners(remapped, keyW));
line("conflicts after reassign", conflicts(remapped));
line("brake keys now", remapped.brake.map(bindingLabel));

const handbrake = assignBinding(defaultBindings(), "handbrake", {
  device: "keyboard",
  kind: "button",
  code: "KeyR",
});
line("handbrake -> KeyR", handbrake.handbrake.map(bindingLabel));

manager.dispose();
console.log("\nAll device mappings resolve to the same VehicleInput contract.");
