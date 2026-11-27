import type {
  AssetBudgetRow,
  AssetManifest,
  BudgetConfig,
  BudgetReport,
  BudgetViolation,
} from "./types.ts";

/**
 * Compare a manifest against the agreed budgets. Returns a structured report;
 * `ok` is false if **any** per-asset or the total limit is exceeded. Limits are
 * inclusive (an asset exactly at its limit passes). Fails closed on unknown kinds.
 */
export function checkBudget(
  manifest: AssetManifest,
  budgets: BudgetConfig,
): BudgetReport {
  const violations: BudgetViolation[] = [];
  const perAsset: AssetBudgetRow[] = [];

  for (const asset of manifest.assets) {
    const limitBytes =
      asset.kind === "unknown" ? 0 : budgets.perAsset[asset.kind];
    const ok = asset.bytes <= limitBytes;
    perAsset.push({
      logicalName: asset.logicalName,
      kind: asset.kind,
      bytes: asset.bytes,
      limitBytes,
      ok,
    });
    if (!ok) {
      violations.push({
        scope: "asset",
        name: asset.logicalName,
        kind: asset.kind,
        actualBytes: asset.bytes,
        limitBytes,
        message:
          asset.kind === "unknown"
            ? `asset '${asset.logicalName}' has an unknown kind and no budget`
            : `asset '${asset.logicalName}' (${asset.kind}) is ${asset.bytes} bytes, over the ${limitBytes}-byte ${asset.kind} budget`,
      });
    }
  }

  if (manifest.totals.bytes > budgets.totalBytes) {
    violations.push({
      scope: "total",
      name: "total",
      actualBytes: manifest.totals.bytes,
      limitBytes: budgets.totalBytes,
      message: `total cold-start ${manifest.totals.bytes} bytes exceeds the ${budgets.totalBytes}-byte budget`,
    });
  }

  return {
    ok: violations.length === 0,
    totalBytes: manifest.totals.bytes,
    totalLimitBytes: budgets.totalBytes,
    byKind: manifest.totals.byKind,
    perAsset,
    violations,
  };
}

/** Human-readable one-asset-per-line summary for CI logs. */
export function formatBudgetReport(report: BudgetReport): string {
  const lines: string[] = [];
  lines.push(report.ok ? "ASSET BUDGET: PASS" : "ASSET BUDGET: FAIL");
  for (const row of report.perAsset) {
    const status = row.ok ? "ok " : "OVER";
    lines.push(
      `  ${status} ${row.logicalName.padEnd(24)} ${String(row.bytes).padStart(10)} / ${String(row.limitBytes).padStart(10)} B (${row.kind})`,
    );
  }
  lines.push(
    `  total ${String(report.totalBytes).padStart(10)} / ${String(report.totalLimitBytes).padStart(10)} B`,
  );
  for (const v of report.violations) lines.push(`  ! ${v.message}`);
  return `${lines.join("\n")}\n`;
}
