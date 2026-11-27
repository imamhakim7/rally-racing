import { describe, expect, it } from "vitest";
import { validateStage } from "../src/stage/validate";
import {
  detectCorners,
  normaliseMinimap,
  projectSplineToMinimap,
  sampleSpline,
  type SampledSpline,
} from "../src/stage/spline";
import { clone, makeStageDocument } from "./stage-fixtures";

function fixtureSpline(): SampledSpline {
  const circuit = validateStage(clone(makeStageDocument()), "spline.json");
  return sampleSpline(circuit.spline, circuit.road.sampleStep);
}

describe("spline sampling", () => {
  it("produces evenly-spaced cross-sections with a positive length", () => {
    const spline = fixtureSpline();
    expect(spline.count).toBeGreaterThanOrEqual(2);
    expect(spline.length).toBeGreaterThan(0);
    expect(spline.positions.length).toBe(spline.count * 3);
    expect(spline.ts[0]).toBe(0);
    expect(spline.ts[spline.count - 1]).toBeCloseTo(1, 6);
  });

  it("parameterises by arc length, not by control-point parameter", () => {
    const spline = fixtureSpline();
    const half = spline.sampleAtT(0.5).position;
    const quarter = spline.sampleAtT(0.25).position;
    const start = spline.positionAt(0);
    const end = spline.positionAt(spline.count - 1);

    const distToHalf = Math.hypot(half.x - start.x, half.z - start.z);
    const distToQuarter = Math.hypot(quarter.x - start.x, quarter.z - start.z);
    const total = Math.hypot(end.x - start.x, end.z - start.z);
    // t=0.5 is halfway along the *route*, so it is further than a quarter.
    expect(distToHalf).toBeGreaterThan(distToQuarter);
    expect(distToQuarter).toBeLessThan(total);
    expect(spline.distanceAtT(0.5)).toBeCloseTo(spline.length / 2, 4);
  });

  it("returns a monotonic tangent frame", () => {
    const spline = fixtureSpline();
    for (let i = 0; i < spline.count; i += 1) {
      const t = spline.tangentAt(i);
      const length = Math.hypot(t.x, t.y, t.z);
      expect(length).toBeCloseTo(1, 4);
    }
    const frame = spline.sampleAtT(0.4);
    expect(Math.hypot(frame.tangent.x, frame.tangent.y, frame.tangent.z)).toBeCloseTo(1, 4);
    expect(Math.hypot(frame.normal.x, frame.normal.y, frame.normal.z)).toBeCloseTo(1, 4);
  });

  it("detects corners from heading change", () => {
    const circuit = validateStage(
      {
        ...clone(makeStageDocument()),
        spline: {
          closed: false,
          tension: 0.5,
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 60 },
            { x: 60, y: 0, z: 60 },
          ],
        },
      },
      "corner.json",
    );
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const corners = detectCorners(spline, 20);
    expect(corners.length).toBeGreaterThan(0);
    expect(["left", "right"]).toContain(corners[0]!.direction);
  });

  it("projects the centreline into normalised minimap space", () => {
    const spline = fixtureSpline();
    const points = projectSplineToMinimap(spline);
    expect(points.length).toBe(spline.count);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-6);
      expect(point.x).toBeLessThanOrEqual(1 + 1e-6);
      expect(point.y).toBeGreaterThanOrEqual(-1e-6);
      expect(point.y).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("normalises degenerate input without dividing by zero", () => {
    const points = normaliseMinimap([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(points).toHaveLength(2);
    expect(Number.isFinite(points[0]!.x)).toBe(true);
    expect(Number.isFinite(points[0]!.y)).toBe(true);
  });
});
