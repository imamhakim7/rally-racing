import { describe, expect, it } from "vitest";
import { FixedTimestepLoop } from "../src/engine/loop";
import { createLaneSurfaceMap } from "../src/physics/surface";
import { Vehicle, type VehicleInput, type VehicleState } from "../src/physics/vehicle";

/**
 * The acceptance criterion "same path at 30/60/144 fps". The physics only ever
 * sees the loop's fixed `dt`; a display running at a different frame rate only
 * changes how many fixed steps happen per frame, never the step size.
 */

const DT = 1 / 60;
const SURFACES = createLaneSurfaceMap(12);

interface Run {
  state: VehicleState;
  steps: number;
}

function driveAtFrameRate(fps: number, seconds: number, input: VehicleInput): Run {
  const car = new Vehicle();
  car.reset({ x: 6, z: -120 });
  const loop = new FixedTimestepLoop(
    {
      update: (dt) => {
        const state = car.getState();
        const surface = SURFACES.surfaceAt(state.x, state.z);
        car.step(input, dt, surface);
      },
      render: () => {},
    },
    { fixedDelta: DT, maxDelta: 1 },
  );

  // Drive a whole number of frames over `seconds`, then flush any sub-step
  // remainder by advancing to the exact target step count. Every frame rate
  // therefore ends on the same simulated instant.
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) loop.tick(1 / fps);
  const targetSteps = Math.round(seconds / DT);
  let guard = 0;
  while (loop.steps < targetSteps && guard++ < 1000) loop.tick(DT);

  return { state: car.getState(), steps: loop.steps };
}

const INPUT: VehicleInput = { throttle: 1, brake: 0, steer: 0.35, handbrake: false };

describe("frame-rate independence", () => {
  it("runs the same number of fixed steps at 30/60/144 fps", () => {
    const runs = [30, 60, 144].map((fps) => driveAtFrameRate(fps, 6, INPUT));
    const base = runs[0]!;
    for (const run of runs) {
      expect(run.steps).toBe(base.steps);
      expect(run.steps).toBe(Math.round(6 / DT));
    }
  });

  it("records the same trajectory at 30/60/144 fps", () => {
    const runs = [30, 60, 144].map((fps) => driveAtFrameRate(fps, 6, INPUT));
    const base = runs[0]!;
    for (const run of runs.slice(1)) {
      expect(run.state.x).toBeCloseTo(base.state.x, 9);
      expect(run.state.z).toBeCloseTo(base.state.z, 9);
      expect(run.state.yaw).toBeCloseTo(base.state.yaw, 9);
      expect(run.state.vLong).toBeCloseTo(base.state.vLong, 9);
      expect(run.state.vLat).toBeCloseTo(base.state.vLat, 9);
      expect(run.state.yawRate).toBeCloseTo(base.state.yawRate, 9);
    }
  });

  it("produces a curved, non-trivial path to compare", () => {
    const run = driveAtFrameRate(60, 6, INPUT);
    expect(run.state.x).toBeGreaterThan(6);
    expect(Math.abs(run.state.yaw)).toBeGreaterThan(0.1);
  });
});
