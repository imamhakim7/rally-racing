import { describe, expect, it } from "vitest";
import { RaceController } from "../src/race/race";
import { buildHudState, minimapDot } from "../src/race/hud-model";
import { createDemoStage, defineStage } from "../src/race/stage";
import type { StageDefinition } from "../src/race/types";

const FIXED_STEP = 1 / 60;

function advance(controller: RaceController, seconds: number): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(FIXED_STEP, remaining);
    controller.update(dt);
    remaining -= dt;
  }
}

/** Start a demo run and skip the countdown. */
function racing(stage: StageDefinition = createDemoStage()): RaceController {
  const controller = new RaceController();
  controller.startStage(stage);
  advance(controller, stage.countdownSeconds);
  return controller;
}

describe("buildHudState — phases (AC1)", () => {
  it("describes stage select and countdown without race data", () => {
    const controller = new RaceController();
    const select = buildHudState(controller, { speedKmh: 0 });
    expect(select.phase).toBe("stage_select");
    expect(select.positionText).toBe("P–");
    expect(select.srSummary).toMatch(/stage select/i);

    controller.startStage(createDemoStage());
    const countdown = buildHudState(controller, { speedKmh: 0 });
    expect(countdown.phase).toBe("countdown");
    expect(countdown.srSummary).toMatch(/countdown/i);
  });

  it("shows speed, time, position and next while racing", () => {
    const controller = racing();
    advance(controller, 30);
    controller.crossGate("cp-1");
    advance(controller, 5);

    const state = buildHudState(controller, { speedKmh: 132.4 });
    expect(state.speedText).toBe("132");
    expect(state.timeText).toBe("0:35.000");
    expect(state.nextText).toBe("Crest");
    expect(state.positionText).toMatch(/^P\d+$/);
    expect(state.srSummary).toContain("132 kilometres per hour");
  });

  it("renders speed as an em dash when telemetry is absent", () => {
    const controller = racing();
    const state = buildHudState(controller, null);
    expect(state.speedText).toBe("–");
    expect(state.srSummary).toContain("Speed unknown");
  });
});

describe("buildHudState — split deltas (AC4)", () => {
  it("marks a faster split ahead (negative) with a glyph", () => {
    const controller = racing();
    advance(controller, 1); // reference for cp-1 is 12s
    controller.crossGate("cp-1");

    const state = buildHudState(controller, { speedKmh: 100 });
    expect(state.split).not.toBeNull();
    expect(state.split!.direction).toBe("ahead");
    expect(state.split!.text.startsWith("-")).toBe(true);
    expect(state.split!.glyph).toBe("▼");
    expect(state.srSummary).toMatch(/ahead of pace/i);
  });

  it("marks a slower split behind (positive) with a glyph", () => {
    const controller = racing();
    advance(controller, 20); // slower than the 12s reference
    controller.crossGate("cp-1");

    const state = buildHudState(controller, { speedKmh: 100 });
    expect(state.split!.direction).toBe("behind");
    expect(state.split!.text.startsWith("+")).toBe(true);
    expect(state.split!.glyph).toBe("▲");
    expect(state.srSummary).toMatch(/behind pace/i);
  });

  it("marks an exactly-on-pace split as even", () => {
    const controller = racing();
    advance(controller, 12); // exactly the cp-1 reference
    controller.crossGate("cp-1");

    const state = buildHudState(controller, { speedKmh: 100 });
    expect(state.split!.direction).toBe("even");
    expect(state.split!.text).toBe("0.000");
    expect(state.split!.glyph).toBe("=");
  });

  it("has no delta before the first split or without a reference", () => {
    const noReference = racing(
      defineStage({ ...createDemoStage(), id: "no-ref", referenceSplits: undefined }),
    );
    advance(noReference, 10);
    noReference.crossGate("cp-1");
    expect(buildHudState(noReference, { speedKmh: 50 }).split).toBeNull();
  });
});

describe("buildHudState — position gating (AC1)", () => {
  it("shows no position on the start line, then a projection after a split", () => {
    const controller = racing();
    // countdown seconds elapsed: 0 splits
    expect(buildHudState(controller, { speedKmh: 0 }).positionText).toBe("P–");

    advance(controller, 1);
    controller.crossGate("cp-1");
    expect(buildHudState(controller, { speedKmh: 0 }).positionText).toMatch(/^P\d+$/);
  });

  it("projects a real position once pace clearly falls behind the field", () => {
    const controller = racing();
    advance(controller, 40); // way behind the reference pace at cp-1
    controller.crossGate("cp-1");
    const state = buildHudState(controller, { speedKmh: 0 });
    const position = Number(state.positionText.slice(1));
    expect(position).toBeGreaterThan(1);
  });

  it("reports the final position and total when finished", () => {
    const controller = racing();
    for (const cp of controller.stage!.checkpoints) {
      advance(controller, 1);
      controller.crossGate(cp.id);
    }
    advance(controller, 1);
    controller.crossGate(controller.stage!.finishId);

    const state = buildHudState(controller, { speedKmh: 0 });
    expect(state.phase).toBe("finished");
    expect(state.positionText).toMatch(/^P\d+$/);
    expect(state.srSummary).toMatch(/finished/i);
  });
});

describe("minimapDot", () => {
  const path = [
    { x: 0.1, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.8 },
  ];

  it("returns the endpoints exactly", () => {
    expect(minimapDot(path, 0)).toEqual({ x: 0.1, y: 0.2 });
    expect(minimapDot(path, 1)).toEqual({ x: 0.9, y: 0.8 });
  });

  it("maps the midpoint and clamps out-of-range ratios", () => {
    expect(minimapDot(path, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(minimapDot(path, -1)).toEqual({ x: 0.1, y: 0.2 });
    expect(minimapDot(path, 9)).toEqual({ x: 0.9, y: 0.8 });
  });

  it("returns null for an empty path", () => {
    expect(minimapDot([], 0.5)).toBeNull();
  });
});

describe("screen-reader key cadence (AC5)", () => {
  it("keeps the key stable within a coarse bucket and changes on a split", () => {
    const controller = racing();
    advance(controller, 1);
    const a = buildHudState(controller, { speedKmh: 100 });
    advance(controller, 2); // same 5s time bucket, same split index, same speed bucket
    const b = buildHudState(controller, { speedKmh: 100 });
    expect(b.srKey).toBe(a.srKey);

    advance(controller, 0.1);
    controller.crossGate("cp-1");
    const c = buildHudState(controller, { speedKmh: 100 });
    expect(c.srKey).not.toBe(a.srKey);
    expect(c.srSummary).toContain("Next gate");
  });
});
