import { afterAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/assets/pipeline.ts";
import { readManifest } from "../src/assets/manifest.ts";
import type { BudgetConfig, LoadProfile } from "../src/assets/types.ts";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const sampleSource = join(process.cwd(), "assets/source");

const profile: LoadProfile = {
  name: "slow-4g",
  downlinkBytesPerSec: 200_000,
  rttMs: 150,
  connectionSetupMs: 300,
  maxParallelStreams: 6,
  jitterPct: 0.15,
};

const budgets: BudgetConfig = {
  schemaVersion: 1,
  profile: "slow-4g",
  perAsset: { model: 262_144, texture: 131_072, audio: 65_536 },
  totalBytes: 524_288,
  coldStartMs: { p50: 1500, p95: 2500 },
};

const tempDirs: string[] = [];
function tempSource(): string {
  const dir = mkdtempSync(join(tmpdir(), "apex6-src-"));
  tempDirs.push(dir);
  cpSync(sampleSource, dir, { recursive: true });
  return dir;
}
function tempOut(): string {
  const dir = mkdtempSync(join(tmpdir(), "apex6-out-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe("runPipeline", () => {
  it("builds hashed, budget-checked bundles from the sample stage", async () => {
    const sourceDir = tempSource();
    const outDir = tempOut();
    const result = await runPipeline({
      sourceDir,
      outDir,
      budgets,
      profile,
      generatedAt: GENERATED_AT,
      geometry: "meshopt",
      trials: 200,
      seed: 1,
    });

    expect(result.manifest.assets).toHaveLength(3);
    expect(result.manifest.assets.map((a) => a.kind).sort()).toEqual([
      "audio",
      "model",
      "texture",
    ]);
    expect(result.budget.ok).toBe(true);
    expect(result.load.ok).toBe(true);

    // Every manifest entry is present on disk under its content-addressed name.
    for (const asset of result.manifest.assets) {
      expect(asset.url).toMatch(/\.[0-9a-f]{8}\./);
      const rel = asset.url.replace(/^\/assets\//, "");
      expect(existsSync(join(outDir, rel))).toBe(true);
    }
    const manifest = readManifest(join(outDir, "manifest.json"));
    expect(manifest.totals.count).toBe(3);
  });

  it("is reproducible: identical manifests for unchanged inputs", async () => {
    const sourceDir = tempSource();
    const outDir = tempOut();
    const first = await runPipeline({ sourceDir, outDir, budgets, profile, generatedAt: GENERATED_AT, seed: 1 });
    const second = await runPipeline({ sourceDir, outDir: tempOut(), budgets, profile, generatedAt: GENERATED_AT, seed: 1 });
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
  });

  it("fails closed when a per-asset budget is exceeded", async () => {
    const sourceDir = tempSource();
    const outDir = tempOut();
    const result = await runPipeline({
      sourceDir,
      outDir,
      budgets: { ...budgets, perAsset: { ...budgets.perAsset, model: 10 } },
      profile,
      generatedAt: GENERATED_AT,
      seed: 1,
    });
    expect(result.budget.ok).toBe(false);
    expect(result.budget.violations.some((v) => v.kind === "model")).toBe(true);
  });

  it("fails closed when the total budget is exceeded", async () => {
    const sourceDir = tempSource();
    const outDir = tempOut();
    const result = await runPipeline({
      sourceDir,
      outDir,
      budgets: { ...budgets, totalBytes: 100 },
      profile,
      generatedAt: GENERATED_AT,
      seed: 1,
    });
    expect(result.budget.ok).toBe(false);
    expect(result.budget.violations.some((v) => v.scope === "total")).toBe(true);
  });

  it("rejects an unknown source asset type", async () => {
    const sourceDir = tempSource();
    writeFileSync(join(sourceDir, "mystery.xyz"), "nope");
    await expect(
      runPipeline({
        sourceDir,
        outDir: tempOut(),
        budgets,
        profile,
        generatedAt: GENERATED_AT,
        seed: 1,
      }),
    ).rejects.toThrow(/unknown asset type/);
  });
});
