import { describe, expect, it } from "vitest";
import { assignBinding, defaultBindings, type ControlBinding } from "../src/input/bindings";
import { createInputManager, isNeutralInput, mergeVehicleInputs } from "../src/input/manager";
import type { GamepadState } from "../src/input/gamepad";
import type { KeyboardTarget, InputSource } from "../src/input/keyboard";
import type { VehicleInput } from "../src/physics/vehicle";

type Listeners = Map<string, (event: KeyboardEvent) => void>;

function fakeKeyboard(): { target: KeyboardTarget; press(code: string): void; release(code: string): void; listeners: Listeners } {
  const listeners: Listeners = new Map();
  const target: KeyboardTarget = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  return {
    target,
    listeners,
    press: (code) => listeners.get("keydown")?.({ code, preventDefault() {} } as KeyboardEvent),
    release: (code) => listeners.get("keyup")?.({ code } as KeyboardEvent),
  };
}

function gamepadWith(buttonPressed: number[], axes: number[] = [0, 0, 0, 0]): GamepadState {
  const buttons = Array.from({ length: 16 }, (_v, i) => ({
    pressed: buttonPressed.includes(i),
    value: buttonPressed.includes(i) ? 1 : 0,
  }));
  return { connected: true, buttons, axes };
}

function fakeTouch(input: VehicleInput): InputSource {
  return { read: () => input, dispose: () => {} };
}

describe("mergeVehicleInputs", () => {
  it("takes max drive, OR handbrake and the largest-magnitude steer", () => {
    const merged = mergeVehicleInputs([
      { throttle: 0.4, brake: 0, steer: 0.2, handbrake: false },
      { throttle: 0, brake: 0.6, steer: -0.9, handbrake: true },
    ]);
    expect(merged).toEqual({ throttle: 0.4, brake: 0.6, steer: -0.9, handbrake: true });
  });

  it("is neutral with no inputs", () => {
    expect(mergeVehicleInputs([])).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: false });
  });
});

describe("createInputManager (AC1)", () => {
  it("drives from the keyboard and reports the active device", () => {
    const kb = fakeKeyboard();
    const manager = createInputManager({
      keyboardTarget: kb.target,
      gamepadState: () => null,
      touch: null,
    });
    expect(isNeutralInput(manager.read())).toBe(true);
    expect(manager.activeDevice).toBe("none");

    kb.press("KeyW");
    expect(manager.read().throttle).toBe(1);
    expect(manager.activeDevice).toBe("keyboard");

    kb.release("KeyW");
    expect(manager.read().throttle).toBe(0);
    manager.dispose();
  });

  it("drives from an injected gamepad", () => {
    const manager = createInputManager({
      keyboardTarget: null,
      gamepadState: () => gamepadWith([0], [0.6, 0, 0, 0]),
      touch: null,
    });
    const input = manager.read();
    expect(input.throttle).toBe(1);
    expect(input.steer).toBeGreaterThan(0);
    expect(manager.activeDevice).toBe("gamepad");
    manager.dispose();
  });

  it("drives from touch", () => {
    const manager = createInputManager({
      keyboardTarget: null,
      gamepadState: () => null,
      touch: fakeTouch({ throttle: 0, brake: 1, steer: -1, handbrake: true }),
    });
    expect(manager.read()).toEqual({ throttle: 0, brake: 1, steer: -1, handbrake: true });
    expect(manager.activeDevice).toBe("touch");
    manager.dispose();
  });

  it("picks up a live remap without recreating the source", () => {
    const kb = fakeKeyboard();
    const manager = createInputManager({ keyboardTarget: kb.target, gamepadState: () => null, touch: null });
    kb.press("KeyI");
    expect(manager.read().throttle).toBe(0);

    const binding: ControlBinding = { device: "keyboard", kind: "button", code: "KeyI" };
    manager.setBindings(assignBinding(defaultBindings(), "throttle", binding));
    expect(manager.read().throttle).toBe(1);
    manager.dispose();
  });

  it("goes neutral when the keyboard source is disabled", () => {
    const manager = createInputManager({ keyboardTarget: null, gamepadState: () => null, touch: null });
    expect(manager.read()).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    manager.dispose();
  });
});
