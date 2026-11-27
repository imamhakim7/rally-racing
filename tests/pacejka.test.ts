import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYRE_SHAPE,
  pacejka,
  pacejkaPeakSlip,
} from "../src/physics/pacejka";

describe("simplified Pacejka tyre curve", () => {
  const curve = { peak: 5000, stiffness: 9, shape: DEFAULT_TYRE_SHAPE };

  it("is zero at zero slip and odd around the origin", () => {
    expect(pacejka(0, curve)).toBe(0);
    for (const slip of [0.01, 0.1, 0.3, 0.8]) {
      expect(pacejka(-slip, curve)).toBeCloseTo(-pacejka(slip, curve), 9);
    }
  });

  it("never exceeds the peak force", () => {
    for (let slip = -2; slip <= 2; slip += 0.01) {
      expect(Math.abs(pacejka(slip, curve))).toBeLessThanOrEqual(curve.peak + 1e-9);
    }
  });

  it("reaches its peak at pacejkaPeakSlip", () => {
    const peakSlip = pacejkaPeakSlip(curve);
    expect(Math.abs(pacejka(peakSlip, curve))).toBeCloseTo(curve.peak, 6);
    // Just beyond the peak the force has already started to fall off (slide).
    expect(Math.abs(pacejka(peakSlip * 2, curve))).toBeLessThan(curve.peak);
  });

  it("builds force monotonically up to the peak", () => {
    const peakSlip = pacejkaPeakSlip(curve);
    let previous = 0;
    for (let slip = 0; slip <= peakSlip; slip += peakSlip / 50) {
      const force = pacejka(slip, curve);
      expect(force).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = force;
    }
  });

  it("is inert for non-finite input", () => {
    expect(pacejka(Number.NaN, curve)).toBe(0);
    expect(pacejka(Number.POSITIVE_INFINITY, curve)).toBe(0);
  });
});
