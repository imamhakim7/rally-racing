import { describe, expect, it } from "vitest";
import { FixedTimestepLoop, type LoopOptions } from "../src/engine/loop";

function makeLoop(options: LoopOptions = {}) {
  const updates: number[] = [];
  const renders: number[] = [];
  const loop = new FixedTimestepLoop(
    {
      update: (dt) => updates.push(dt),
      render: (alpha) => renders.push(alpha),
    },
    options,
  );
  return { loop, updates, renders };
}

describe("FixedTimestepLoop", () => {
  it("advances exactly N fixed steps for a given elapsed time (AC1)", () => {
    const { loop, updates, renders } = makeLoop({ fixedDelta: 1 / 60, maxDelta: 1 });

    const steps = loop.tick(1.0);

    expect(steps).toBe(60);
    expect(updates).toHaveLength(60);
    expect(loop.steps).toBe(60);
    expect(renders).toHaveLength(1);
    expect(loop.alpha).toBe(0);
  });

  it("always steps the simulation by exactly fixedDelta", () => {
    const { loop, updates } = makeLoop({ fixedDelta: 1 / 60, maxDelta: 1 });
    loop.tick(0.5);
    for (const dt of updates) expect(dt).toBe(1 / 60);
  });

  it("accumulates leftover time across ticks and interpolates in [0,1) (AC2)", () => {
    const { loop } = makeLoop({ fixedDelta: 1 / 60, maxDelta: 1 });

    expect(loop.tick(0.5)).toBe(30);
    expect(loop.tick(0.5)).toBe(30);
    expect(loop.steps).toBe(60);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it("exposes a fractional interpolation factor for a partial frame", () => {
    const { loop } = makeLoop({ fixedDelta: 0.1 });
    expect(loop.tick(0.25)).toBe(2);
    expect(loop.alpha).toBeCloseTo(0.5, 10);
  });

  it("clamps a long frame to maxDelta to avoid a spiral of death (AC3)", () => {
    const { loop, updates } = makeLoop({ fixedDelta: 1 / 60, maxDelta: 0.25 });

    expect(loop.tick(10)).toBe(15);
    expect(updates).toHaveLength(15);
  });

  it("ignores non-positive or non-finite elapsed time without NaN", () => {
    const { loop } = makeLoop();
    expect(loop.tick(0)).toBe(0);
    expect(loop.tick(-5)).toBe(0);
    expect(loop.tick(Number.NaN)).toBe(0);
    expect(loop.alpha).toBe(0);
    expect(Number.isFinite(loop.alpha)).toBe(true);
  });

  it("schedules and cancels frames through the injected clock", () => {
    let clock = 1000;
    const scheduled: Array<(t: number) => void> = [];
    const cancelled: number[] = [];
    const { loop } = makeLoop({
      now: () => clock,
      requestFrame: (cb) => {
        scheduled.push(cb);
        return scheduled.length;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });

    loop.start();
    expect(loop.running).toBe(true);
    expect(scheduled).toHaveLength(1);

    // Drive one frame 16ms later.
    clock += 16;
    scheduled[0]?.(clock);

    loop.start(); // idempotent
    expect(scheduled).toHaveLength(2);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(cancelled).toEqual([2]);
  });

  it("stops ticking once disposed", () => {
    const { loop } = makeLoop({ fixedDelta: 1 / 60, maxDelta: 1 });
    loop.tick(1);
    loop.dispose();
    loop.dispose(); // idempotent
    expect(loop.tick(1)).toBe(0);
    expect(loop.steps).toBe(60);
  });

  // Regression for #APEX-21: dispose() called from inside update() must not
  // render a frame after the scene/renderer were released.
  it("does not render after dispose() from inside update()", () => {
    const updates: number[] = [];
    const renders: number[] = [];
    let loop: FixedTimestepLoop | null = null;
    loop = new FixedTimestepLoop(
      {
        update: () => {
          updates.push(1);
          loop?.dispose();
        },
        render: () => renders.push(1),
      },
      { fixedDelta: 1 / 60, maxDelta: 1 },
    );

    const steps = loop.tick(1);

    expect(steps).toBe(1); // the disposing step aborts the remaining steps
    expect(updates).toHaveLength(1);
    expect(renders).toHaveLength(0);
    expect(loop.steps).toBe(1);
  });

  // Regression for #APEX-20: stop() called from inside update() must not leave a
  // frame armed (a stale frame becomes a second rAF chain after a restart).
  function makeScheduler() {
    const scheduled: Array<(t: number) => void> = [];
    const cancelled: number[] = [];
    let clock = 0;
    return {
      scheduled,
      cancelled,
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
      requestFrame: (cb: (t: number) => void) => {
        scheduled.push(cb);
        return scheduled.length;
      },
      cancelFrame: (h: number) => cancelled.push(h),
    };
  }

  it("does not arm another frame when stop() runs inside update()", () => {
    const s = makeScheduler();
    let steps = 0;
    const loop = new FixedTimestepLoop(
      {
        update: () => {
          steps++;
          if (steps === 1) loop.stop();
        },
        render: () => {},
      },
      {
        fixedDelta: 1 / 60,
        maxDelta: 1,
        now: s.now,
        requestFrame: s.requestFrame,
        cancelFrame: s.cancelFrame,
      },
    );

    loop.start();
    expect(s.scheduled).toHaveLength(1);
    s.advance(100); // 6 fixed steps; the first calls stop()
    s.scheduled[0]?.(s.now());

    expect(loop.running).toBe(false);
    // No frame may be armed after stop().
    expect(s.scheduled).toHaveLength(1);
    // A mid-tick stop also aborts the rest of the current tick.
    expect(steps).toBe(1);
  });

  it("restart after a stop-in-update keeps exactly one frame chain", () => {
    const s = makeScheduler();
    let steps = 0;
    const loop = new FixedTimestepLoop(
      {
        update: () => {
          steps++;
          if (steps === 1) loop.stop();
        },
        render: () => {},
      },
      {
        fixedDelta: 1 / 60,
        maxDelta: 1,
        now: s.now,
        requestFrame: s.requestFrame,
        cancelFrame: s.cancelFrame,
      },
    );

    loop.start();
    s.advance(100);
    s.scheduled[0]?.(s.now()); // stops mid-tick

    s.advance(100);
    loop.start(); // restart

    const before = s.scheduled.length;
    let rearming = 0;
    for (let i = 1; i < before; i++) {
      const count = s.scheduled.length;
      s.scheduled[i]?.(s.now());
      if (s.scheduled.length > count) rearming++;
    }
    expect(rearming).toBe(1);
  });
});
