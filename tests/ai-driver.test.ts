import { describe, expect, it } from "vitest";
import { validateStage } from "../src/stage/validate";
import { sampleSpline } from "../src/stage/spline";
import { buildRacingLine } from "../src/ai/racing-line";
import { CpuDriver } from "../src/ai/driver";
import { physicsSurfaceAt } from "../src/ai/surface";
import { clone, makeStageDocument } from "./stage-fixtures";

const DT = 1 / 60;

function circuit() {
  const doc = clone(makeStageDocument());
  doc.spline = {
    closed: false,
    tension: 0.5,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 80 },
      { x: 30, y: 0, z: 130 },
      { x: 90, y: 0, z: 150 },
    ],
  };
  doc.road = { width: 9, sampleStep: 2, surface: "gravel", bankingDeg: 0 };
  return validateStage(doc, "driver.json");
}

function line(c = circuit()) {
  return buildRacingLine(c, sampleSpline(c.spline, c.road.sampleStep));
}

describe("CpuDriver — control law", () => {
  it("steers back toward the line when pushed to one side", () => {
    const c = circuit();
    const raceLine = line(c);
    const driver = new CpuDriver({ id: "d" });
    driver.setSampleStep(c.road.sampleStep);
    driver.placeOnLine(raceLine, 20, 0);
    const frame = raceLine.sampleAtDistance(20);
    const start = driver.vehicle.getState();
    // Shift the car two metres to the right of the line, still moving forward.
    driver.vehicle.setState({
      x: start.x + frame.normal.x * 2,
      z: start.z + frame.normal.z * 2,
      vLong: 15,
    });
    const input = driver.control(raceLine, physicsSurfaceAt(c, 0.2), []);
    expect(input.steer).toBeLessThan(0);
  });

  it("always emits finite, clamped inputs", () => {
    const c = circuit();
    const raceLine = line(c);
    const driver = new CpuDriver({ id: "d" });
    driver.setSampleStep(c.road.sampleStep);
    driver.placeOnLine(raceLine, 5, 0);
    const frame = raceLine.sampleAtDistance(5);
    const start = driver.vehicle.getState();
    driver.vehicle.setState({
      x: start.x + frame.normal.x * 8,
      z: start.z + frame.normal.z * 8,
      vLong: 30,
    });
    const input = driver.control(raceLine, physicsSurfaceAt(c, 0.1), []);
    expect(input.steer).toBeGreaterThanOrEqual(-1);
    expect(input.steer).toBeLessThanOrEqual(1);
    expect(input.throttle).toBeGreaterThanOrEqual(0);
    expect(input.throttle).toBeLessThanOrEqual(1);
    expect(input.brake).toBeGreaterThanOrEqual(0);
    expect(input.brake).toBeLessThanOrEqual(1);
    expect(Number.isFinite(input.steer)).toBe(true);
  });

  it("holds the racing line on a solo run without leaving the road", () => {
    const c = circuit();
    const raceLine = line(c);
    const driver = new CpuDriver({ id: "solo", skill: 1 });
    driver.setSampleStep(c.road.sampleStep);
    driver.placeOnLine(raceLine, 0, 0);

    const halfWidth = c.road.width / 2;
    let maxOffset = 0;
    let steps = 0;
    while (driver.distance < raceLine.length - 0.5 && steps < 60 * 90) {
      const t = Math.min(Math.max(driver.distance / raceLine.length, 0), 1);
      const input = driver.control(raceLine, physicsSurfaceAt(c, t), []);
      driver.vehicle.step(input, DT, physicsSurfaceAt(c, t));
      maxOffset = Math.max(maxOffset, Math.abs(driver.centerOffset));
      steps += 1;
    }
    expect(driver.distance).toBeGreaterThan(raceLine.length - 1);
    expect(maxOffset).toBeLessThan(halfWidth);
  });

  it("brakes for a corner and accelerates out of it", () => {
    const c = circuit();
    const raceLine = line(c);
    const driver = new CpuDriver({ id: "solo", skill: 1 });
    driver.setSampleStep(c.road.sampleStep);
    driver.placeOnLine(raceLine, 0, 0);

    let sawBrake = false;
    let maxThrottle = 0;
    let steps = 0;
    while (driver.distance < raceLine.length - 0.5 && steps < 60 * 90) {
      const t = Math.min(Math.max(driver.distance / raceLine.length, 0), 1);
      const input = driver.control(raceLine, physicsSurfaceAt(c, t), []);
      if (input.brake > 0.1) sawBrake = true;
      maxThrottle = Math.max(maxThrottle, input.throttle);
      driver.vehicle.step(input, DT, physicsSurfaceAt(c, t));
      steps += 1;
    }
    // The car both slows for the corner and drives hard on the straight.
    expect(sawBrake).toBe(true);
    expect(maxThrottle).toBeGreaterThan(0.8);
  });
});
