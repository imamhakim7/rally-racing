import { describe, expect, it } from "vitest";
import { validateStage } from "../src/stage/validate";
import { sampleSpline } from "../src/stage/spline";
import { createContainment, DEFAULT_CONTAINMENT_SHOULDER } from "../src/stage/containment";
import { Vehicle } from "../src/physics/vehicle";
import { clone, makeStageDocument } from "./stage-fixtures";

function fixture() {
  const circuit = validateStage(clone(makeStageDocument()), "containment.json");
  const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
  return { circuit, containment: createContainment(circuit, spline) };
}

describe("roadside containment (#APEX-28)", () => {
  it("pulls a car that runs wide back inside the corridor and damps it (AC3)", () => {
    const { circuit, containment } = fixture();
    expect(containment.halfWidth).toBeCloseTo(circuit.road.width / 2 + DEFAULT_CONTAINMENT_SHOULDER, 6);

    const result = containment.resolve(30, 30, 0);
    expect(result.contained).toBe(true);
    expect(Math.abs(result.lateral)).toBeGreaterThan(result.limit);
    // Corrected point is back on the boundary (within the corridor).
    const corrected = containment.resolve(result.position.x, result.position.z, 0);
    expect(corrected.contained).toBe(false);
    expect(Math.abs(corrected.lateral)).toBeLessThanOrEqual(containment.halfWidth + 1e-6);
    expect(result.impact).toBeGreaterThan(0);
    expect(result.impact).toBeLessThan(1);
  });

  it("leaves a car already on the road untouched", () => {
    const { containment } = fixture();
    const result = containment.resolve(0, 30, 0);
    expect(result.contained).toBe(false);
    expect(result.position).toEqual({ x: 0, y: result.position.y, z: 30 });
    expect(result.impact).toBe(1);
  });

  it("applies the barrier to a real vehicle state, idempotently", () => {
    const { containment } = fixture();
    const vehicle = new Vehicle();
    vehicle.setState({ x: 30, z: 30, yaw: 0, vLong: 20, vLat: 6 });

    const first = containment.apply(vehicle);
    expect(first.contained).toBe(true);
    const state = vehicle.getState();
    expect(state.vLat).toBe(0);
    expect(state.vLong).toBeLessThan(20);
    expect(Math.abs(containment.resolve(state.x, state.z, state.yaw).lateral)).toBeLessThanOrEqual(
      containment.halfWidth + 1e-6,
    );

    // Second application is a no-op (already inside).
    const second = containment.apply(vehicle);
    expect(second.contained).toBe(false);
    expect(vehicle.getState()).toEqual(state);
  });

  it("never throws on a non-finite state", () => {
    const { containment } = fixture();
    const vehicle = new Vehicle();
    vehicle.setState({ x: Number.NaN, z: 0, yaw: 0, vLong: 5, vLat: 0 });
    expect(() => containment.apply(vehicle)).not.toThrow();
  });
});
