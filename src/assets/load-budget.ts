import type {
  AssetManifest,
  BudgetConfig,
  LoadProfile,
  LoadReport,
} from "./types.ts";

/** Deterministic PRNG (mulberry32) so a fixed seed reproduces a report exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolation percentile over an ascending-sorted sample. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile: empty sample");
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

function assertProfile(profile: LoadProfile): void {
  const positive = [
    "downlinkBytesPerSec",
    "rttMs",
    "connectionSetupMs",
    "maxParallelStreams",
  ] as const;
  for (const key of positive) {
    const v = profile[key];
    if (!Number.isFinite(v) || v < 0 || (key === "maxParallelStreams" && v < 1)) {
      throw new Error(`load profile '${profile.name}': invalid ${key}=${v}`);
    }
  }
  if (!Number.isFinite(profile.jitterPct) || profile.jitterPct < 0) {
    throw new Error(
      `load profile '${profile.name}': invalid jitterPct=${profile.jitterPct}`,
    );
  }
}

export interface SimulateOptions {
  trials?: number;
  seed?: number;
}

/**
 * Simulate a cold-start load of every manifest asset over a throttled profile.
 *
 * Model (deliberately simple and conservative — see docs/assets/asset-pipeline.md):
 *
 *   rounds      = ceil(count / maxParallelStreams)     // HTTP/2 head-of-line rounds
 *   transferMs  = totalBytes / (downlinkBytesPerSec × (1 + jitter)) × 1000
 *   coldStartMs = connectionSetupMs + rttMs × rounds + transferMs
 *
 * `jitter ∈ [-jitterPct, +jitterPct]` is drawn deterministically per trial from the
 * seed, so the p50/p95 are reproducible. Over `trials` we return the percentiles and
 * assert against the agreed `coldStartMs` budget. This is a model, not a live
 * measurement, so CI can gate on it without a device farm.
 */
export function simulateColdStart(
  manifest: AssetManifest,
  profile: LoadProfile,
  budget: BudgetConfig["coldStartMs"],
  opts: SimulateOptions = {},
): LoadReport {
  const trials = opts.trials ?? 200;
  const seed = opts.seed ?? 1;
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`simulateColdStart: trials must be a positive integer, got ${trials}`);
  }
  assertProfile(profile);

  const totalBytes = manifest.totals.bytes;
  const count = manifest.totals.count;
  const rounds = Math.ceil(count / profile.maxParallelStreams);
  const rng = mulberry32(seed);

  const samples: number[] = [];
  for (let i = 0; i < trials; i++) {
    const jitter = (rng() * 2 - 1) * profile.jitterPct;
    const effectiveDownlink = profile.downlinkBytesPerSec * (1 + jitter);
    const transferMs = (totalBytes / effectiveDownlink) * 1000;
    samples.push(
      profile.connectionSetupMs + profile.rttMs * rounds + transferMs,
    );
  }
  samples.sort((a, b) => a - b);

  const p50Ms = percentile(samples, 50);
  const p95Ms = percentile(samples, 95);

  return {
    profile: profile.name,
    trials,
    seed,
    totalBytes,
    p50Ms,
    p95Ms,
    minMs: samples[0]!,
    maxMs: samples[samples.length - 1]!,
    budgetP50Ms: budget.p50,
    budgetP95Ms: budget.p95,
    ok: p50Ms <= budget.p50 && p95Ms <= budget.p95,
  };
}
