import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EngineApp } from "../src/engine/app";
import type { RendererHandle } from "../src/engine/renderer";
import type { SceneHandle } from "../src/engine/scene";
import { StageSession } from "../src/race/session";
import { createDemoStage } from "../src/race/stage";

const FIXED_STEP = 1 / 60;

/** Advance a session by `seconds` in fixed steps (as the engine would). */
function advanceSession(session: StageSession, seconds: number): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(FIXED_STEP, remaining);
    session.update(dt);
    remaining -= dt;
  }
}

/** Advance an engine by `seconds`, chunked so the loop never clamps a tick. */
function tickSeconds(app: EngineApp, seconds: number): void {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(0.25, remaining);
    app.tick(dt);
    remaining -= dt;
  }
}

function makeRenderer(): RendererHandle {
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement;
  return { domElement: canvas, render: vi.fn(), setSize: vi.fn(), dispose: vi.fn() };
}

function makeSceneHandle(): SceneHandle {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    update: vi.fn(),
    interpolate: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("StageSession", () => {
  it("notifies subscribers immediately and then on phase changes", () => {
    const session = new StageSession(createDemoStage());
    const seen: string[] = [];
    session.subscribe((controller) => seen.push(controller.phase));

    expect(seen).toEqual(["stage_select"]);

    session.start();
    expect(seen).toEqual(["stage_select", "countdown"]);

    advanceSession(session, 3); // countdown -> racing (single phase change)
    expect(seen).toEqual(["stage_select", "countdown", "racing"]);

    session.update(0.5); // no phase change -> no extra notification
    expect(seen).toEqual(["stage_select", "countdown", "racing"]);
  });

  it("clears all race state through restart and quit", () => {
    const session = new StageSession(createDemoStage());
    session.start();
    advanceSession(session, 3);
    advanceSession(session, 1);
    session.crossGate("cp-1");

    session.restart();
    expect(session.phase).toBe("countdown");
    expect(session.controller.elapsed).toBe(0);
    expect(session.controller.missedCount).toBe(0);

    session.quit();
    expect(session.phase).toBe("stage_select");
    expect(session.result).toBeNull();
  });

  it("unsubscribes cleanly", () => {
    const session = new StageSession(createDemoStage());
    const listener = vi.fn();
    const off = session.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    session.start();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("StageSession — engine integration", () => {
  it("advances the race clock from the fixed-timestep loop", () => {
    const session = new StageSession(createDemoStage());
    const app = new EngineApp({
      renderer: makeRenderer(),
      sceneHandle: makeSceneHandle(),
      fixedDelta: 1 / 60,
      maxDelta: 1,
      onUpdate: (dt) => session.update(dt),
    });

    session.start();
    tickSeconds(app, 3); // exactly the countdown
    expect(session.phase).toBe("racing");

    app.tick(1); // one second of race time
    expect(session.controller.elapsed).toBeCloseTo(1, 9);

    session.crossGate("cp-1");
    expect(session.controller.nextCheckpoint?.id).toBe("cp-2");
  });

  it("runs a full stage end to end through the engine loop", () => {
    const session = new StageSession(createDemoStage());
    const app = new EngineApp({
      renderer: makeRenderer(),
      sceneHandle: makeSceneHandle(),
      fixedDelta: 1 / 60,
      maxDelta: 1,
      onUpdate: (dt) => session.update(dt),
    });

    session.start();
    tickSeconds(app, 3);
    for (const cp of createDemoStage().checkpoints) {
      app.tick(1);
      session.crossGate(cp.id);
    }
    app.tick(1);
    session.crossGate("finish");

    const result = session.result!;
    expect(result.valid).toBe(true);
    const sum = result.splits.reduce((acc, s) => acc + s.delta, 0);
    expect(result.totalTime).toBeCloseTo(sum + result.penaltySeconds, 9);
  });

  it("calls onRender hooks each rendered frame", () => {
    const onRender = vi.fn();
    const app = new EngineApp({
      renderer: makeRenderer(),
      sceneHandle: makeSceneHandle(),
      fixedDelta: 1 / 60,
      maxDelta: 1,
      onRender,
    });
    app.tick(1);
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});
