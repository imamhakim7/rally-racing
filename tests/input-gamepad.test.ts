import { describe, expect, it } from "vitest";
import {
  applyDeadzone,
  firstConnectedGamepad,
  gamepadToActions,
  toGamepadState,
  type GamepadState,
} from "../src/input/gamepad";
import { actionsToVehicleInput } from "../src/input/actions";

function makeState(pressed: Record<number, number> = {}, axes: number[] = [0, 0, 0, 0]): GamepadState {
  const buttons = Array.from({ length: 16 }, (_v, i) =>
    pressed[i] !== undefined ? { pressed: true, value: pressed[i]! } : { pressed: false, value: 0 },
  );
  return { connected: true, buttons, axes };
}

describe("gamepad mapping (AC1)", () => {
  it("is neutral when unplugged or absent", () => {
    expect(gamepadToActions(null)).toMatchObject({ throttle: 0, brake: 0, steerLeft: 0, steerRight: 0 });
    expect(gamepadToActions({ connected: false, buttons: [], axes: [] })).toMatchObject({ throttle: 0 });
  });

  it("maps RT/A to throttle, LT/B to brake and X to handbrake (default table)", () => {
    expect(gamepadToActions(makeState({ 7: 1 })).throttle).toBe(1);
    expect(gamepadToActions(makeState({ 0: 1 })).throttle).toBe(1);
    expect(gamepadToActions(makeState({ 6: 1 })).brake).toBe(1);
    expect(gamepadToActions(makeState({ 1: 1 })).brake).toBe(1);
    expect(gamepadToActions(makeState({ 2: 1 })).handbrake).toBe(1);
  });

  it("steers from the left stick with a deadzone", () => {
    const right = gamepadToActions(makeState({}, [0.5, 0, 0, 0]));
    expect(right.steerLeft).toBe(0);
    expect(right.steerRight).toBeCloseTo(0.41, 1);
    expect(actionsToVehicleInput(right).steer).toBeGreaterThan(0);

    const left = gamepadToActions(makeState({}, [-0.5, 0, 0, 0]));
    expect(left.steerLeft).toBeCloseTo(0.41, 1);
    expect(left.steerRight).toBe(0);
    expect(actionsToVehicleInput(left).steer).toBeLessThan(0);

    expect(gamepadToActions(makeState({}, [0.1, 0, 0, 0])).steerRight).toBe(0);
  });

  it("applies deadzone rescaled from 0 (no jump past the threshold)", () => {
    expect(applyDeadzone(0.1, 0.15)).toBe(0);
    expect(applyDeadzone(0.15, 0.15)).toBe(0);
    expect(applyDeadzone(1, 0.15)).toBeCloseTo(1, 5);
    expect(applyDeadzone(-1, 0.15)).toBeCloseTo(-1, 5);
    expect(applyDeadzone(0.5, 0.15)).toBeCloseTo(0.41, 2);
  });
});

describe("gamepad snapshot helpers", () => {
  it("converts a connected pad and skips disconnected ones", () => {
    const pad = { connected: true, buttons: [{ pressed: true, value: 1 }], axes: [0] };
    expect(toGamepadState(pad)).toEqual({ connected: true, buttons: pad.buttons, axes: [0] });
    expect(toGamepadState({ ...pad, connected: false })).toBeNull();
    expect(firstConnectedGamepad([null, { ...pad, connected: false }, pad])).toEqual({
      connected: true,
      buttons: pad.buttons,
      axes: [0],
    });
    expect(firstConnectedGamepad(null)).toBeNull();
  });
});
