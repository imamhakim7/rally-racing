import { describe, expect, it } from "vitest";
import {
  FULL_MOTION,
  REDUCED_MOTION,
  cameraMotion,
  motionPolicy,
  resolveMotionState,
  shakeOffset,
} from "../src/engine/motion";

describe("resolveMotionState (AC4)", () => {
  it("prefers 'on'/'off' and falls back to the system flag for 'auto'", () => {
    expect(resolveMotionState("on", false)).toBe("reduced");
    expect(resolveMotionState("off", true)).toBe("full");
    expect(resolveMotionState("auto", true)).toBe("reduced");
    expect(resolveMotionState("auto", false)).toBe("full");
  });

  it("maps states to a policy", () => {
    expect(motionPolicy("reduced")).toEqual(REDUCED_MOTION);
    expect(motionPolicy("full")).toEqual(FULL_MOTION);
  });
});

describe("cameraMotion (AC4)", () => {
  it("returns zero shake and blur under reduced motion, at any speed", () => {
    expect(cameraMotion(REDUCED_MOTION, 0)).toEqual({ shake: 0, blur: 0 });
    expect(cameraMotion(REDUCED_MOTION, 1)).toEqual({ shake: 0, blur: 0 });
  });

  it("scales with speed and is zero at a standstill when full", () => {
    expect(cameraMotion(FULL_MOTION, 0)).toEqual({ shake: 0, blur: 0 });
    const slow = cameraMotion(FULL_MOTION, 0.5);
    const fast = cameraMotion(FULL_MOTION, 1);
    expect(fast.shake).toBeGreaterThan(slow.shake);
    expect(fast.blur).toBeGreaterThan(slow.blur);
  });
});

describe("shakeOffset", () => {
  it("is deterministic and bounded by the amplitude", () => {
    const a = shakeOffset(1.234, 0.3, 7);
    expect(a).toEqual(shakeOffset(1.234, 0.3, 7));
    expect(Math.abs(a.x)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(0.3);
  });

  it("is exactly zero without amplitude (reduced motion)", () => {
    expect(shakeOffset(5, 0)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(5, NaN)).toEqual({ x: 0, y: 0 });
  });
});
