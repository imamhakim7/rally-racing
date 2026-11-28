import { describe, expect, it } from "vitest";
import {
  actionsToVehicleInput,
  neutralActions,
  type ActionValues,
} from "../src/input/actions";
import {
  assignBinding,
  bindingKey,
  bindingLabel,
  bindingOwners,
  conflicts,
  DEFAULT_BINDINGS,
  defaultBindings,
  hasConflicts,
  normalizeBindings,
  type Bindings,
  type ControlBinding,
} from "../src/input/bindings";
import { mapKeys, mapKeysToActions } from "../src/input/keyboard";

describe("actionsToVehicleInput (AC1)", () => {
  it("maps throttle/brake and composes steering right − left", () => {
    const values: ActionValues = { ...neutralActions(), throttle: 1, steerRight: 1 };
    expect(actionsToVehicleInput(values)).toMatchObject({ throttle: 1, brake: 0, steer: 1 });
    expect(actionsToVehicleInput({ ...neutralActions(), steerLeft: 1 })).toMatchObject({ steer: -1 });
    expect(actionsToVehicleInput({ ...neutralActions(), steerLeft: 1, steerRight: 1 })).toMatchObject({ steer: 0 });
    expect(actionsToVehicleInput({ ...neutralActions(), handbrake: 1 })).toMatchObject({ handbrake: true });
  });

  it("clamps out-of-range and non-finite intensities", () => {
    const values = { ...neutralActions(), throttle: 5, brake: -2, steerLeft: NaN };
    expect(actionsToVehicleInput(values)).toEqual({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  });
});

describe("keyboard bindings (AC1/AC2)", () => {
  it("preserves the #APEX-10 default keys through the binding table", () => {
    expect(mapKeys(new Set(["KeyW", "ArrowUp"]))).toMatchObject({ throttle: 1, brake: 0 });
    expect(mapKeys(new Set(["KeyS"]))).toMatchObject({ brake: 1, throttle: 0 });
    expect(mapKeys(new Set(["KeyD"]))).toMatchObject({ steer: 1 });
    expect(mapKeys(new Set(["KeyA"]))).toMatchObject({ steer: -1 });
    expect(mapKeys(new Set(["KeyA", "KeyD"]))).toMatchObject({ steer: 0 });
    expect(mapKeys(new Set(["Space"]))).toMatchObject({ handbrake: true });
    expect(mapKeys(new Set())).toMatchObject({ throttle: 0, brake: 0, steer: 0 });
  });

  it("honours a remapped table", () => {
    const custom: Bindings = { ...defaultBindings(), throttle: [{ device: "keyboard", kind: "button", code: "KeyI" }] };
    expect(mapKeysToActions(new Set(["KeyI"]), custom).throttle).toBe(1);
    expect(mapKeysToActions(new Set(["KeyW"]), custom).throttle).toBe(0);
  });
});

describe("conflicts (AC2)", () => {
  it("reports no conflict for the defaults (steering axis is exempt)", () => {
    expect(conflicts(DEFAULT_BINDINGS)).toEqual([]);
    expect(hasConflicts(DEFAULT_BINDINGS)).toBe(false);
  });

  it("reports a key shared by two actions (e.g. a hand-edited table)", () => {
    const shared: ControlBinding = { device: "keyboard", kind: "button", code: "KeyW" };
    const broken: Bindings = { ...defaultBindings(), brake: [...DEFAULT_BINDINGS.brake, shared] };
    const list = conflicts(broken);
    expect(list).toHaveLength(1);
    expect(list[0]!.actions).toEqual(["brake", "throttle"]);
    expect(bindingKey(list[0]!.binding)).toBe("keyboard:button:KeyW");
  });

  it("bindingOwners names the action a control would be taken from (AC2)", () => {
    const keyW: ControlBinding = { device: "keyboard", kind: "button", code: "KeyW" };
    expect(bindingOwners(DEFAULT_BINDINGS, keyW)).toEqual(["throttle"]);
    expect(bindingOwners(DEFAULT_BINDINGS, keyW, "throttle")).toEqual([]);
  });

  it("assignBinding reassigns the binding so it never double-fires", () => {
    const moved: ControlBinding = { device: "keyboard", kind: "button", code: "KeyR" };
    const once = assignBinding(DEFAULT_BINDINGS, "handbrake", moved);
    const twice = assignBinding(once, "throttle", moved);
    expect(twice.handbrake.some((b) => b.code === "KeyR")).toBe(false);
    expect(twice.throttle.some((b) => b.code === "KeyR")).toBe(true);
    expect(conflicts(twice)).toEqual([]);
  });
});

describe("normalizeBindings (robustness)", () => {
  it("falls back to defaults for garbage, missing or empty actions", () => {
    expect(normalizeBindings(null)).toEqual(DEFAULT_BINDINGS);
    expect(normalizeBindings({ throttle: "nope", brake: [] })).toMatchObject({
      throttle: DEFAULT_BINDINGS.throttle,
      brake: DEFAULT_BINDINGS.brake,
    });
  });

  it("keeps valid entries and drops malformed ones", () => {
    const result = normalizeBindings({
      throttle: [
        { device: "keyboard", kind: "button", code: "KeyI" },
        { device: "mouse", kind: "button", code: "Left" },
      ],
    });
    expect(result.throttle).toEqual([{ device: "keyboard", kind: "button", code: "KeyI" }]);
  });
});

describe("binding labels", () => {
  it("labels keyboard, button and axis bindings", () => {
    expect(bindingLabel({ device: "keyboard", kind: "button", code: "KeyW" })).toBe("W");
    expect(bindingLabel({ device: "gamepad", kind: "button", code: "7" })).toMatch(/RT/);
    expect(bindingLabel({ device: "gamepad", kind: "axis", code: "0" })).toBe("Stick 0");
  });
});
