import { describe, expect, it } from "vitest";
import { TUTORIAL_LESSONS, TutorialModel } from "../src/ui/tutorial";
import type { VehicleInput } from "../src/physics/vehicle";

const input = (over: Partial<VehicleInput> = {}): VehicleInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  ...over,
});

describe("tutorial model (#APEX-11)", () => {
  it("orders the lessons accelerate -> brake -> handbrake -> steer (AC5)", () => {
    expect(TUTORIAL_LESSONS.map((lesson) => lesson.id)).toEqual([
      "accelerate",
      "brake",
      "handbrake",
      "steer",
    ]);
  });

  it("advances only on the current lesson's action", () => {
    const model = new TutorialModel();
    expect(model.lesson?.id).toBe("accelerate");
    // Braking first does not satisfy (or skip) the accelerate lesson.
    expect(model.observe(input({ brake: 1 }))).toBe(false);
    expect(model.lesson?.id).toBe("accelerate");
    // Throttle satisfies it and moves on.
    expect(model.observe(input({ throttle: 1 }))).toBe(true);
    expect(model.lesson?.id).toBe("brake");
  });

  it("never skips ahead", () => {
    const model = new TutorialModel();
    // Handbrake is lesson 3; it must not satisfy lessons 1 or 2.
    expect(model.observe(input({ handbrake: true }))).toBe(false);
    expect(model.index).toBe(0);
  });

  it("gates steering on the car actually moving", () => {
    const model = new TutorialModel();
    model.observe(input({ throttle: 1 }));
    model.observe(input({ brake: 1 }));
    model.observe(input({ handbrake: true }));
    expect(model.lesson?.id).toBe("steer");
    // Steering on the start line (no speed) does not count.
    expect(model.observe(input({ steer: 1 }), 0)).toBe(false);
    expect(model.complete).toBe(false);
    // Once rolling, steering counts.
    expect(model.observe(input({ steer: -1 }), 12)).toBe(true);
    expect(model.complete).toBe(true);
  });

  it("reports completion and ignores further input", () => {
    const model = new TutorialModel();
    model.observe(input({ throttle: 1 }));
    model.observe(input({ brake: 1 }));
    model.observe(input({ handbrake: true }));
    model.observe(input({ steer: 1 }), 20);
    expect(model.complete).toBe(true);
    expect(model.observe(input({ throttle: 1 }))).toBe(false);
    expect(model.srText).toBe("Tutorial complete.");
  });

  it("resets to the first lesson", () => {
    const model = new TutorialModel();
    model.observe(input({ throttle: 1 }));
    model.reset();
    expect(model.index).toBe(0);
    expect(model.complete).toBe(false);
  });

  it("exposes a screen-reader sentence with step count", () => {
    const model = new TutorialModel();
    expect(model.srText).toContain("Lesson 1 of 4");
    expect(model.srText).toContain("Accelerate");
  });
});
