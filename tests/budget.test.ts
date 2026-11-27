import { describe, expect, it } from "vitest";
import { checkBudget, formatBudgetReport } from "../src/assets/budget.ts";
import { buildManifest, finalizeAsset } from "../src/assets/manifest.ts";
import type { BudgetConfig } from "../src/assets/types.ts";

const budgets: BudgetConfig = {
  schemaVersion: 1,
  profile: "slow-4g",
  perAsset: { model: 100, texture: 50, audio: 25 },
  totalBytes: 140,
  coldStartMs: { p50: 1500, p95: 2500 },
};

function manifestOf(assets: { name: string; kind: "model" | "texture" | "audio"; bytes: Uint8Array }[]) {
  return buildManifest(
    assets.map(
      (a) => finalizeAsset({ logicalName: a.name, kind: a.kind, ext: "bin", bytes: a.bytes }).record,
    ),
    "1970-01-01T00:00:00.000Z",
  );
}

describe("checkBudget", () => {
  it("passes when every asset and the total are within budget", () => {
    const report = checkBudget(
      manifestOf([
        { name: "m", kind: "model", bytes: new Uint8Array(100) },
        { name: "t", kind: "texture", bytes: new Uint8Array(40) },
      ]),
      budgets,
    );
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("treats the limit as inclusive", () => {
    const report = checkBudget(
      manifestOf([{ name: "m", kind: "model", bytes: new Uint8Array(100) }]),
      { ...budgets, totalBytes: 100 },
    );
    expect(report.ok).toBe(true);
  });

  it("fails one byte over the per-asset budget and names the asset", () => {
    const report = checkBudget(
      manifestOf([{ name: "big", kind: "model", bytes: new Uint8Array(101) }]),
      { ...budgets, totalBytes: 1000 },
    );
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    const v = report.violations[0]!;
    expect(v.scope).toBe("asset");
    expect(v.name).toBe("big");
    expect(v.kind).toBe("model");
    expect(v.actualBytes).toBe(101);
    expect(v.limitBytes).toBe(100);
    expect(v.message).toContain("big");
  });

  it("fails the total budget even when each asset is individually within its kind limit", () => {
    const report = checkBudget(
      manifestOf([
        { name: "m", kind: "model", bytes: new Uint8Array(100) },
        { name: "t", kind: "texture", bytes: new Uint8Array(50) },
      ]),
      budgets, // total 150 > 140
    );
    expect(report.ok).toBe(false);
    const total = report.violations.find((v) => v.scope === "total")!;
    expect(total.actualBytes).toBe(150);
    expect(total.limitBytes).toBe(140);
  });

  it("rejects an unknown kind with a zero budget", () => {
    const manifest = buildManifest(
      [
        {
          logicalName: "mystery",
          url: "/assets/misc/mystery.abc.json",
          hash: "00000000",
          bytes: 10,
          kind: "unknown",
          contentType: "application/octet-stream",
          cacheControl: "public, max-age=0",
        },
      ],
      "1970-01-01T00:00:00.000Z",
    );
    const report = checkBudget(manifest, budgets);
    expect(report.ok).toBe(false);
    expect(report.violations[0]!.message).toContain("unknown kind");
  });

  it("formats a readable report", () => {
    const report = checkBudget(manifestOf([{ name: "m", kind: "model", bytes: new Uint8Array(1) }]), budgets);
    const text = formatBudgetReport(report);
    expect(text).toContain("ASSET BUDGET: PASS");
    expect(text).toContain("m");
  });
});
