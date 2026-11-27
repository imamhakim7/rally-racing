import { describe, expect, it } from "vitest";
import { RaceController } from "../src/race/race";
import { createDemoStage, defineStage } from "../src/race/stage";
import type { StageDefinition } from "../src/race/types";

const FIXED_STEP = 1 / 60;

/** Advance the race clock by `seconds` in fixed steps (as the engine does). */
function advance(controller: RaceController, seconds: number): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(FIXED_STEP, remaining);
    controller.update(dt);
    remaining -= dt;
  }
}

function demo(): StageDefinition {
  return createDemoStage();
}

/** Drive a whole stage crossing every checkpoint in order, then the finish. */
function runClean(controller: RaceController, secondsPerGate = 1): void {
  for (const checkpoint of controller.stage!.checkpoints) {
    advance(controller, secondsPerGate);
    controller.crossGate(checkpoint.id);
  }
  advance(controller, secondsPerGate);
  controller.crossGate(controller.stage!.finishId);
}

describe("RaceController — countdown gates input then starts the timer (AC1)", () => {
  it("starts in stage_select and enters countdown on startStage", () => {
    const controller = new RaceController();
    expect(controller.phase).toBe("stage_select");
    expect(controller.inputEnabled).toBe(false);

    controller.startStage(demo());
    expect(controller.phase).toBe("countdown");
    expect(controller.inputEnabled).toBe(false);
    expect(controller.countdownRemaining).toBe(3);
  });

  it("ignores gate crossings during the countdown", () => {
    const controller = new RaceController();
    controller.startStage(demo());

    controller.crossGate("cp-1");
    controller.crossGate("finish");

    expect(controller.phase).toBe("countdown");
    expect(controller.result).toBeNull();
    expect(controller.nextCheckpoint).toBeNull();
  });

  it("enters racing after countdownSeconds and starts the clock at zero", () => {
    const controller = new RaceController();
    controller.startStage(demo());

    advance(controller, 1);
    advance(controller, 1);
    expect(controller.phase).toBe("countdown");
    advance(controller, 1);

    expect(controller.phase).toBe("racing");
    expect(controller.inputEnabled).toBe(true);
    expect(controller.elapsed).toBe(0);

    advance(controller, 0.5);
    expect(controller.elapsed).toBeCloseTo(0.5, 9);
  });

  it("rejects a second startStage while counting down or racing", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3); // racing

    const other = defineStage({ ...demo(), id: "other", name: "Other" });
    controller.startStage(other);

    expect(controller.stage!.id).toBe("hairpin-hollow");
  });
});

describe("RaceController — checkpoints must be crossed in order (AC2)", () => {
  it("records a split and advances the expected checkpoint in order", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);

    expect(controller.nextCheckpoint?.id).toBe("cp-1");
    advance(controller, 1);
    controller.crossGate("cp-1");

    expect(controller.nextCheckpoint?.id).toBe("cp-2");
    expect(controller.missedCount).toBe(0);
  });

  it("penalises the checkpoints skipped when a later one is crossed", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);

    advance(controller, 2);
    controller.crossGate("cp-2"); // skips cp-1

    expect(controller.missedCount).toBe(1);
    expect(controller.penaltySeconds).toBe(5);
    expect(controller.nextCheckpoint?.id).toBe("cp-3");
  });

  it("ignores an already-crossed checkpoint and an unknown gate", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    advance(controller, 1);
    controller.crossGate("cp-1");

    controller.crossGate("cp-1"); // already crossed
    controller.crossGate("nowhere"); // unknown

    expect(controller.missedCount).toBe(0);
    expect(controller.nextCheckpoint?.id).toBe("cp-2");
  });
});

describe("RaceController — a missed checkpoint penalises or invalidates (AC3)", () => {
  it("adds penaltySeconds per missed checkpoint and still finishes", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);

    advance(controller, 1);
    controller.crossGate("cp-3"); // skips cp-1 + cp-2
    advance(controller, 1);
    controller.crossGate("finish");

    expect(controller.phase).toBe("finished");
    expect(controller.missedCount).toBe(2);
    expect(controller.penaltySeconds).toBe(10);
    expect(controller.result!.valid).toBe(true);
  });

  it("invalidates the run when misses exceed maxPenalties", () => {
    const strict = defineStage({
      ...demo(),
      id: "strict",
      maxPenalties: 1,
      checkpoints: [
        { id: "a", index: 0, name: "A" },
        { id: "b", index: 1, name: "B" },
        { id: "c", index: 2, name: "C" },
        { id: "d", index: 3, name: "D" },
      ],
      referenceSplits: undefined, // reference ids no longer match the new checkpoints
    });
    const controller = new RaceController();
    controller.startStage(strict);
    advance(controller, 3);

    advance(controller, 1);
    controller.crossGate("d"); // skips a, b, c -> 3 misses > 1

    expect(controller.phase).toBe("invalidated");
    expect(controller.result!.valid).toBe(false);
    expect(controller.result!.position).toBeNull();
    expect(controller.result!.missedCount).toBe(3);
  });

  it("penalises checkpoints never crossed when the finish is reached", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);

    advance(controller, 4);
    controller.crossGate("finish"); // no checkpoints crossed at all

    expect(controller.phase).toBe("finished");
    expect(controller.missedCount).toBe(3);
    expect(controller.penaltySeconds).toBe(15);
  });
});

describe("RaceController — finish stops the timer and ranks the result (AC4)", () => {
  it("stops the clock at the finish and reports position and total", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    runClean(controller, 1);

    expect(controller.phase).toBe("finished");
    const finished = controller.elapsed;

    advance(controller, 100); // post-finish updates are inert
    expect(controller.elapsed).toBe(finished);

    const result = controller.result!;
    expect(result.totalTime).toBeCloseTo(4, 9);
    expect(result.position).toBe(1); // 4s beats every opponent
    expect(result.standings[0]).toMatchObject({ name: "You", position: 1, isPlayer: true });
  });

  it("ranks the player against opponents by total time", () => {
    const stage = defineStage({
      ...demo(),
      countdownSeconds: 0,
      opponents: [{ name: "Fast", time: 3 }],
    });
    const controller = new RaceController();
    controller.startStage(stage);
    runClean(controller, 1); // total 4s

    expect(controller.result!.position).toBe(2);
  });
});

describe("RaceController — results total equals the sum of splits (AC5)", () => {
  it("total === sum(split.delta) + penalties for a penalised run", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3); // racing

    advance(controller, 2);
    controller.crossGate("cp-2"); // miss cp-1 (+5s), split @2
    advance(controller, 1);
    controller.crossGate("cp-3"); // split @3
    advance(controller, 1);
    controller.crossGate("finish"); // split @4

    const result = controller.result!;
    const sum = result.splits.reduce((acc, split) => acc + split.delta, 0);
    expect(sum).toBeCloseTo(4, 9);
    expect(result.totalTime).toBeCloseTo(sum + result.penaltySeconds, 9);
    expect(result.totalTime).toBeCloseTo(9, 9);
  });

  it("holds for an unpenalised run too", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    runClean(controller, 0.5);

    const result = controller.result!;
    const sum = result.splits.reduce((acc, split) => acc + split.delta, 0);
    expect(result.penaltySeconds).toBe(0);
    expect(result.totalTime).toBeCloseTo(sum, 9);
  });
});

describe("RaceController — restart and quit reset cleanly (AC6)", () => {
  it("restart re-enters countdown with zero residual state", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    advance(controller, 1);
    controller.crossGate("cp-1");
    advance(controller, 1);
    controller.crossGate("finish");

    controller.restart();

    expect(controller.phase).toBe("countdown");
    expect(controller.elapsed).toBe(0);
    expect(controller.missedCount).toBe(0);
    expect(controller.penaltySeconds).toBe(0);
    expect(controller.result).toBeNull();
    expect(controller.nextCheckpoint).toBeNull();
  });

  it("quit returns to stage select and clears the run", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    advance(controller, 2);
    controller.crossGate("cp-2");

    controller.quit();

    expect(controller.phase).toBe("stage_select");
    expect(controller.stage).toBeNull();
    expect(controller.result).toBeNull();
    expect(controller.elapsed).toBe(0);
    expect(controller.inputEnabled).toBe(false);
  });

  it("can start a fresh stage after quit", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    controller.quit();
    controller.startStage(demo());

    expect(controller.phase).toBe("countdown");
  });
});

describe("RaceController — clock hygiene", () => {
  it("ignores non-positive and non-finite dt without producing NaN", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);

    controller.update(0);
    controller.update(-4);
    controller.update(Number.NaN);
    controller.update(Number.POSITIVE_INFINITY);

    expect(controller.elapsed).toBe(0);
    expect(Number.isFinite(controller.elapsed)).toBe(true);
  });

  it("clamps a huge step so a stalled tab cannot jump the race", () => {
    const controller = new RaceController({ maxDelta: 0.25 });
    controller.startStage(demo());
    advance(controller, 3); // racing

    controller.update(10); // clamped to 0.25
    expect(controller.elapsed).toBeCloseTo(0.25, 9);
  });

  it("starts racing immediately when countdownSeconds is 0", () => {
    const controller = new RaceController();
    controller.startStage(defineStage({ ...demo(), countdownSeconds: 0 }));
    expect(controller.phase).toBe("racing");
  });

  it("never exposes elapsed below zero or a negative countdown", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    expect(controller.countdownRemaining).toBeGreaterThanOrEqual(0);
    controller.update(1e-12);
    expect(controller.countdownRemaining).toBeGreaterThanOrEqual(0);
  });
});

describe("RaceController — HUD projections (AC1)", () => {
  it("has no last split, progress or position before the first gate", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    expect(controller.lastSplit).toBeNull();
    expect(controller.progressRatio).toBe(0);
    expect(controller.projectedPosition).toBeNull();
  });

  it("advances progress and records the last split as gates are crossed", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    advance(controller, 12); // exactly the cp-1 reference
    controller.crossGate("cp-1");

    expect(controller.lastSplit?.checkpointId).toBe("cp-1");
    expect(controller.progressRatio).toBeCloseTo(12 / 44, 6);
    // At reference pace the projected 44s finish sits behind Vega (42.5s) but
    // ahead of Kovač (47.9s) -> P2.
    expect(controller.projectedPosition).toBe(2);
  });

  it("projects a worse position when pace collapses behind the reference", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    advance(controller, 60);
    controller.crossGate("cp-1"); // ~5x the reference pace for this sector
    expect(controller.projectedPosition).toBeGreaterThan(1);
  });

  it("reports progress 1 at the finish", () => {
    const controller = new RaceController();
    controller.startStage(demo());
    advance(controller, 3);
    runClean(controller);
    expect(controller.phase).toBe("finished");
    expect(controller.progressRatio).toBe(1);
    expect(controller.projectedPosition).toBeNull(); // only meaningful while racing
  });
});

describe("defineStage — reference pace validation", () => {
  it("accepts a valid non-decreasing reference", () => {
    expect(() => demo()).not.toThrow();
  });

  it("rejects a reference to an unknown gate", () => {
    expect(() =>
      defineStage({
        ...demo(),
        referenceSplits: [{ checkpointId: "nope", time: 5 }],
      }),
    ).toThrow(/unknown gate/i);
  });

  it("rejects a decreasing cumulative reference", () => {
    expect(() =>
      defineStage({
        ...demo(),
        referenceSplits: [
          { checkpointId: "cp-1", time: 12 },
          { checkpointId: "cp-2", time: 8 },
        ],
      }),
    ).toThrow(/non-decreasing/i);
  });

  it("rejects a non-finite reference time", () => {
    expect(() =>
      defineStage({
        ...demo(),
        referenceSplits: [{ checkpointId: "cp-1", time: Number.NaN }],
      }),
    ).toThrow(/finite/i);
  });
});
