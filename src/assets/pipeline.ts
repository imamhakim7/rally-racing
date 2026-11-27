import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { splitExt } from "./hash.ts";
import { detectKind, KIND_DIR } from "./formats.ts";
import { finalizeAsset, buildManifest, writeManifest } from "./manifest.ts";
import { optimizeGlb, encodeKtx2 } from "./optimize.ts";
import { checkBudget } from "./budget.ts";
import { simulateColdStart } from "./load-budget.ts";
import type {
  AssetManifest,
  AssetRecord,
  BudgetConfig,
  BudgetReport,
  GeometryCodec,
  LoadProfile,
  LoadReport,
} from "./types.ts";

export interface PipelineOptions {
  sourceDir: string;
  outDir: string;
  budgets: BudgetConfig;
  profile: LoadProfile;
  /** CDN mount point for manifest URLs. Default `/assets`. */
  baseUrl?: string;
  /** Injected build time; defaults to now. Tests pass a fixed value for determinism. */
  generatedAt?: string;
  geometry?: GeometryCodec;
  trials?: number;
  seed?: number;
}

export interface PipelineResult {
  manifest: AssetManifest;
  budget: BudgetReport;
  load: LoadReport;
  /** Files written, relative to `outDir`. */
  outputs: string[];
}

async function optimizeByKind(
  kind: AssetRecord["kind"],
  ext: string,
  bytes: Uint8Array,
  geometry: GeometryCodec,
): Promise<{ ext: string; bytes: Uint8Array }> {
  switch (kind) {
    case "model":
      return { ext: "glb", bytes: await optimizeGlb(bytes, { geometry }) };
    case "texture":
      return { ext: "ktx2", bytes: await encodeKtx2(bytes) };
    case "audio":
      // Already-encoded runtime audio is passed through unchanged.
      return { ext, bytes };
    default:
      throw new Error(`cannot optimize unknown asset kind (ext .${ext})`);
  }
}

/**
 * Full source → dist build. Reads every file in `sourceDir`, compresses it by kind,
 * content-addresses it into `outDir/<kind>/`, writes `manifest.json`, and returns the
 * budget + load reports. Budget/load failure is reported in the result (the CLI turns
 * it into a non-zero exit code); the build itself always writes its artifacts.
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const geometry = opts.geometry ?? "meshopt";
  const baseUrl = opts.baseUrl ?? "/assets";
  const files = readdirSync(opts.sourceDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

  const records: AssetRecord[] = [];
  const outputs: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const { base, ext } = splitExt(file);
    const kind = detectKind(ext);
    if (kind === "unknown") {
      throw new Error(
        `unknown asset type '${file}' (extension .${ext || "<none>"}) — add it to src/assets/formats.ts or remove it`,
      );
    }
    if (seen.has(base)) {
      throw new Error(`duplicate logical asset name '${base}' — names must be unique`);
    }
    seen.add(base);

    const source = new Uint8Array(readFileSync(join(opts.sourceDir, file)));
    const optimized = await optimizeByKind(kind, ext, source, geometry);
    const { record, bytes } = finalizeAsset(
      { logicalName: base, kind, ext: optimized.ext, bytes: optimized.bytes },
      baseUrl,
    );
    records.push(record);

    const rel = join(KIND_DIR[kind], basename(record.url));
    mkdirSync(join(opts.outDir, KIND_DIR[kind]), { recursive: true });
    writeFileSync(join(opts.outDir, rel), bytes);
    outputs.push(rel);
  }

  const manifest = buildManifest(
    records,
    opts.generatedAt ?? new Date().toISOString(),
  );
  writeManifest(join(opts.outDir, "manifest.json"), manifest);
  outputs.push("manifest.json");

  const budget = checkBudget(manifest, opts.budgets);
  const load = simulateColdStart(manifest, opts.profile, opts.budgets.coldStartMs, {
    trials: opts.trials,
    seed: opts.seed,
  });

  return { manifest, budget, load, outputs };
}
