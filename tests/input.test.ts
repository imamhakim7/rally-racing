import { describe, expect, it } from "vitest";
import {
  createKeyboardInput,
  mapKeys,
  type KeyboardTarget,
} from "../src/input/keyboard";

describe("keyboard input", () => {
  it("maps WASD/arrows/space to a vehicle command", () => {
    expect(mapKeys(new Set(["KeyW", "ArrowUp"]))).toMatchObject({ throttle: 1, brake: 0 });
    expect(mapKeys(new Set(["KeyS"]))).toMatchObject({ brake: 1, throttle: 0 });
    expect(mapKeys(new Set(["KeyD"]))).toMatchObject({ steer: 1 });
    expect(mapKeys(new Set(["KeyA"]))).toMatchObject({ steer: -1 });
    expect(mapKeys(new Set(["KeyA", "KeyD"]))).toMatchObject({ steer: 0 });
    expect(mapKeys(new Set(["Space"]))).toMatchObject({ handbrake: true });
    expect(mapKeys(new Set())).toMatchObject({ throttle: 0, brake: 0, steer: 0 });
  });

  it("tracks keydown/keyup through an injected target", () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const target: KeyboardTarget = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    const input = createKeyboardInput(target);

    listeners.get("keydown")?.({ code: "KeyW", preventDefault() {} } as KeyboardEvent);
    expect(input.read().throttle).toBe(1);

    listeners.get("keydown")?.({ code: "KeyD", preventDefault() {} } as KeyboardEvent);
    expect(input.read()).toMatchObject({ throttle: 1, steer: 1 });

    listeners.get("keyup")?.({ code: "KeyW" } as KeyboardEvent);
    expect(input.read().throttle).toBe(0);

    // Losing focus releases every key so the car does not drive itself.
    listeners.get("blur")?.({} as KeyboardEvent);
    expect(input.read()).toMatchObject({ throttle: 0, steer: 0 });

    input.dispose();
    expect(listeners.size).toBe(0);
  });
});
