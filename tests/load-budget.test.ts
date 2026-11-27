import { describe, expect, it } from "vitest";
import { percentile, simulateColdStart } from "../src/assets/load-budget.ts";
import { buildManifest, finalizeAsset } from "../src/assets/manifest.ts";
import type { BudgetConfig, LoadProfile } from "../src/assets/types.ts";

const profile: LoadProfile = {
  name: "slow-4g",
  downlinkBytesPerSec: 200_000,
  rttMs: 150,
  connectionSetupMs: 300,
  maxParallelStreams: 6,
  jitterPct: 0.15,
};

const budget: BudgetConfig["coldStartMs"] = { p50: 1500, p95: 2500 };

function manifest(bytes: number, count = 1) {
  const assets = Array.from({ length: count }, (_, i) =>
    finalizeAsset({
      logicalName: `a${i}`,
      kind: "model",
      ext: "bin",
      bytes: new Uint8Array(bytes),
    }).record,
  );
  return buildManifest(assets, "1970-01-01T00:00:00.000Z");
}

describe("percentile", () => {
  it("interpolates between ranks", () => {
    expect(percentile([0, 10, 20, 30], 50)).toBe(15);
    expect(percentile([5], 95)).toBe(5);
  });
});

describe("simulateColdStart", () => {
  it("reports p50 <= p95 and compares to the budget", () => {
    const report = simulateColdStart(manifest(50_000), profile, budget, {
      trials: 200,
      seed: 1,
    });
    expect(report.p50Ms).toBeLessThanOrEqual(report.p95Ms);
    expect(report.ok).toBe(true);
    expect(report.totalBytes).toBe(50_000);
  });

  it("is deterministic for a fixed seed", () => {
    const a = simulateColdStart(manifest(50_000), profile, budget, { trials: 50, seed: 7 });
    const b = simulateColdStart(manifest(50_000), profile, budget, { trials: 50, seed: 7 });
    expect(a.p95Ms).toBe(b.p95Ms);
    const c = simulateColdStart(manifest(50_000), profile, budget, { trials: 50, seed: 8 });
    expect(c.p95Ms).not.toBe(a.p95Ms);
  });

  it("fails the gate when the payload is far over budget", () => {
    const report = simulateColdStart(manifest(5_000_000), profile, budget, {
      trials: 50,
      seed: 1,
    });
    expect(report.ok).toBe(false);
  });

  it("counts an HTTP/2 round per maxParallelStreams", () => {
    const one = simulateColdStart(manifest(1, 3), profile, budget, { trials: 50, seed: 1 });
    // 1 round → setup 300 + rtt 150
    expect(one.minMs).toBeGreaterThanOrEqual(450);
    expect(one.maxMs).toBeLessThan(460);
  });

  it("handles an empty manifest (setup only)", () => {
    const report = simulateColdStart(manifest(0, 0), profile, budget, {
      trials: 10,
      seed: 1,
    });
    expect(report.totalBytes).toBe(0);
    expect(report.p95Ms).toBe(300);
  });

  it("rejects invalid inputs", () => {
    expect(() => simulateColdStart(manifest(1), profile, budget, { trials: 0 })).toThrow();
    expect(() =>
      simulateColdStart(manifest(1), { ...profile, downlinkBytesPerSec: -1 }, budget),
    ).toThrow();
  });
});
