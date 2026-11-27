/**
 * Domain types for the Apex Rally asset pipeline (APEX-6).
 *
 * The pipeline is intentionally data-in / data-out: every stage operates on plain
 * objects and byte arrays so it is headless-testable and deterministic.
 */

/** Runtime asset categories the pipeline budgets and hosts. */
export type AssetKind = "model" | "texture" | "audio" | "unknown";

/** Which geometry-compression extension a build uses. */
export type GeometryCodec = "meshopt" | "draco";

/** A single content-addressed runtime asset, as recorded in the manifest. */
export interface AssetRecord {
  /** Stable, human-readable id (e.g. `gate-arch`). */
  logicalName: string;
  /** Content-addressed path served by the CDN (e.g. `/assets/models/gate-arch.1a2b3c4d.glb`). */
  url: string;
  /** First 8 hex chars of the SHA-256 of the output bytes. */
  hash: string;
  /** Output size in bytes. */
  bytes: number;
  kind: AssetKind;
  contentType: string;
  cacheControl: string;
}

export interface ManifestTotals {
  bytes: number;
  count: number;
  byKind: Partial<Record<AssetKind, number>>;
}

/** The importer's only mapping from logical name to a hashed CDN URL. */
export interface AssetManifest {
  schemaVersion: 1;
  generatedAt: string;
  assets: AssetRecord[];
  totals: ManifestTotals;
}

/** The agreed budgets (single source of truth, `docs/assets/budgets.json`). */
export interface BudgetConfig {
  schemaVersion: 1;
  /** Load profile name this budget is agreed against. */
  profile: string;
  /** Per-asset byte ceiling by kind (inclusive). */
  perAsset: Record<Exclude<AssetKind, "unknown">, number>;
  /** Total cold-start transfer ceiling in bytes (inclusive). */
  totalBytes: number;
  coldStartMs: { p50: number; p95: number };
}

export interface BudgetViolation {
  scope: "asset" | "total";
  /** Asset logical name for an `asset` violation; `"total"` for the total. */
  name: string;
  kind?: AssetKind;
  actualBytes: number;
  limitBytes: number;
  message: string;
}

export interface AssetBudgetRow {
  logicalName: string;
  kind: AssetKind;
  bytes: number;
  limitBytes: number;
  ok: boolean;
}

export interface BudgetReport {
  ok: boolean;
  totalBytes: number;
  totalLimitBytes: number;
  byKind: Partial<Record<AssetKind, number>>;
  perAsset: AssetBudgetRow[];
  violations: BudgetViolation[];
}

/** A throttled network profile (Chrome DevTools presets are the canonical values). */
export interface LoadProfile {
  name: string;
  downlinkBytesPerSec: number;
  rttMs: number;
  connectionSetupMs: number;
  maxParallelStreams: number;
  /** Fractional bandwidth jitter per trial, e.g. 0.15 = ±15%. */
  jitterPct: number;
}

export interface LoadReport {
  profile: string;
  trials: number;
  seed: number;
  totalBytes: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  budgetP50Ms: number;
  budgetP95Ms: number;
  ok: boolean;
}
