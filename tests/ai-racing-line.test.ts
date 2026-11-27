import { describe, expect, it } from "vitest";
import { validateStage } from "../src/stage/validate";
import { sampleSpline } from "../src/stage/spline";
import { buildRacingLine } from "../src/ai/racing-line";
import { clone, makeStageDocument } from "./stage-fixtures";

/** A stage with a long straight then a corner, so the speed profile must differ. */
function cornerCircuit() {
  const doc = clone(makeStageDocument());
  doc.spline = {
    closed: false,
    tension: 0.5,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 90 },
      { x: 20, y: 0, z: 140 },
      { x: 80, y: 0, z: 160 },
    ],
  };
  doc.road = { width: 9, sampleStep: 2, surface: "gravel", bankingDeg: 0 };
  return validateStage(doc, "corner.json");
}

describe("buildRacingLine", () => {
  it("produces a point per sample with a positive reference time", () => {
    const circuit = cornerCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const line = buildRacingLine(circuit, spline);
    expect(line.points).toHaveLength(spline.count);
    expect(line.length).toBeCloseTo(spline.length, 3);
    expect(line.referenceTime).toBeGreaterThan(0);
    expect(Number.isFinite(line.referenceTime)).toBe(true);
  });

  it("keeps the lateral offset on the road surface", () => {
    const circuit = cornerCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const line = buildRacingLine(circuit, spline);
    const maxOffset = 0.6 * (circuit.road.width / 2);
    for (const point of line.points) {
      expect(Math.abs(point.offset)).toBeLessThanOrEqual(maxOffset + 1e-6);
    }
  });

  it("targets a lower speed on corners than on straights", () => {
    const circuit = cornerCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const line = buildRacingLine(circuit, spline);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const corners = line.points.filter((p) => Math.abs(p.curvature) > 0.012);
    const straights = line.points.filter((p) => Math.abs(p.curvature) <= 0.012);
    expect(corners.length).toBeGreaterThan(0);
    expect(straights.length).toBeGreaterThan(0);
    expect(mean(corners.map((p) => p.targetSpeed))).toBeLessThan(
      mean(straights.map((p) => p.targetSpeed)),
    );
  });

  it("clamps sampling at both ends of the line", () => {
    const circuit = cornerCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const line = buildRacingLine(circuit, spline);
    expect(line.sampleAtDistance(-100).distance).toBeCloseTo(0, 6);
    expect(line.sampleAtDistance(line.length + 100).distance).toBeCloseTo(line.length, 3);
    expect(line.indexAtDistance(-100)).toBe(0);
    expect(line.indexAtDistance(line.length + 100)).toBe(line.points.length - 1);
  });

  it("caps the target speed at the configured maximum", () => {
    const circuit = cornerCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const line = buildRacingLine(circuit, spline, { vMax: 22 });
    for (const point of line.points) {
      expect(point.targetSpeed).toBeLessThanOrEqual(22 + 1e-6);
    }
  });
});
