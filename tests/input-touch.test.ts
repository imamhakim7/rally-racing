import { describe, expect, it } from "vitest";
import { NEUTRAL_TOUCH_PAD, steerFromOffset, touchPadToInput } from "../src/input/touch";

describe("touch mapping (AC1)", () => {
  it("is neutral for the neutral pad", () => {
    expect(touchPadToInput(NEUTRAL_TOUCH_PAD)).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });
  });

  it("drives, steers and handbrakes", () => {
    expect(touchPadToInput({ steer: 1, throttle: 1, brake: 0, handbrake: false })).toMatchObject({
      throttle: 1,
      brake: 0,
      steer: 1,
    });
    expect(touchPadToInput({ steer: -0.5, throttle: 0, brake: 1, handbrake: true })).toMatchObject({
      brake: 1,
      steer: -0.5,
      handbrake: true,
    });
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(touchPadToInput({ steer: 9, throttle: 9, brake: -1, handbrake: false })).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
      handbrake: false,
    });
    expect(touchPadToInput({ steer: NaN, throttle: NaN, brake: NaN, handbrake: false }).steer).toBe(0);
  });
});

describe("steerFromOffset", () => {
  it("normalises the drag offset into −1..1 and guards a zero radius", () => {
    expect(steerFromOffset(50, 100)).toBe(0.5);
    expect(steerFromOffset(-50, 100)).toBe(-0.5);
    expect(steerFromOffset(999, 100)).toBe(1);
    expect(steerFromOffset(10, 0)).toBe(0);
    expect(steerFromOffset(NaN, 100)).toBe(0);
  });
});
