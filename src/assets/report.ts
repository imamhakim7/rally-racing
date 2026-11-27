import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatBudgetReport } from "./budget.ts";
import type { PipelineResult } from "./pipeline.ts";

export interface ReportMeta {
  ticket: string;
  profile: string;
  geometry: string;
  generatedAt: string;
}

/** The machine-readable CI budget report artifact. */
export interface BudgetReportArtifact {
  ticket: string;
  schemaVersion: 1;
  generatedAt: string;
  profile: string;
  geometry: string;
  ok: boolean;
  totals: {
    bytes: number;
    count: number;
    byKind: Record<string, number>;
    limitBytes: number;
  };
  budgets: {
    perAsset: Record<string, number>;
    totalBytes: number;
    coldStartMs: { p50: number; p95: number };
  };
  assets: {
    logicalName: string;
    kind: string;
    url: string;
    hash: string;
    bytes: number;
  }[];
  load: PipelineResult["load"];
  violations: PipelineResult["budget"]["violations"];
}

export function buildReportArtifact(
  result: PipelineResult,
  meta: ReportMeta,
  perAssetLimits: Record<string, number>,
): BudgetReportArtifact {
  const { manifest, budget, load } = result;
  return {
    ticket: meta.ticket,
    schemaVersion: 1,
    generatedAt: meta.generatedAt,
    profile: meta.profile,
    geometry: meta.geometry,
    ok: budget.ok && load.ok,
    totals: {
      bytes: manifest.totals.bytes,
      count: manifest.totals.count,
      byKind: manifest.totals.byKind as Record<string, number>,
      limitBytes: budget.totalLimitBytes,
    },
    budgets: {
      perAsset: perAssetLimits,
      totalBytes: budget.totalLimitBytes,
      coldStartMs: { p50: load.budgetP50Ms, p95: load.budgetP95Ms },
    },
    assets: manifest.assets.map((a) => ({
      logicalName: a.logicalName,
      kind: a.kind,
      url: a.url,
      hash: a.hash,
      bytes: a.bytes,
    })),
    load,
    violations: budget.violations,
  };
}

/** Human-readable CI log / evidence text. */
export function formatReportText(
  report: BudgetReportArtifact,
  result: PipelineResult,
): string {
  const lines: string[] = [];
  lines.push(`Asset budget report — ${report.ticket}`);
  lines.push(`profile=${report.profile} geometry=${report.geometry} generatedAt=${report.generatedAt}`);
  lines.push("");
  lines.push(formatBudgetReport(result.budget).trimEnd());
  lines.push("");
  lines.push("Content-addressed assets:");
  for (const a of report.assets) {
    lines.push(`  ${a.url}  (${a.bytes} B, sha256:${a.hash})`);
  }
  lines.push("");
  lines.push(
    `Cold-start load [${report.load.profile}] trials=${report.load.trials} seed=${report.load.seed}: ` +
      `p50=${report.load.p50Ms.toFixed(1)}ms (budget ${report.load.budgetP50Ms}ms), ` +
      `p95=${report.load.p95Ms.toFixed(1)}ms (budget ${report.load.budgetP95Ms}ms) ` +
      `→ ${report.load.ok ? "PASS" : "FAIL"}`,
  );
  lines.push("");
  lines.push(`OVERALL: ${report.ok ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

export function writeReportArtifacts(
  evidenceDir: string,
  report: BudgetReportArtifact,
  text: string,
): { jsonPath: string; txtPath: string } {
  mkdirSync(evidenceDir, { recursive: true });
  const jsonPath = join(evidenceDir, "APEX-6-budget-report.json");
  const txtPath = join(evidenceDir, "APEX-6-budget-report.txt");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(txtPath, text, "utf8");
  return { jsonPath, txtPath };
}
