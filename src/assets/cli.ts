#!/usr/bin/env bun
/**
 * Asset pipeline CLI (APEX-6).
 *
 *   bun run assets:build   # source -> dist + manifest, write budget report, gate
 *   bun run assets:check   # re-check the existing manifest against budgets (CI)
 *
 * Both commands exit non-zero when a budget or load gate fails — that is the CI gate.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "./pipeline.ts";
import { readManifest } from "./manifest.ts";
import { checkBudget } from "./budget.ts";
import { simulateColdStart } from "./load-budget.ts";
import {
  buildReportArtifact,
  formatReportText,
  writeReportArtifacts,
} from "./report.ts";
import type { BudgetConfig, GeometryCodec, LoadProfile } from "./types.ts";

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, "assets/source");
const OUT_DIR = join(ROOT, "assets/dist");
const EVIDENCE_DIR = join(ROOT, "docs/evidence");
const TICKET = "APEX-6";

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface ProfileFile {
  [name: string]: LoadProfile;
}

const budgets = loadJson<BudgetConfig>(join(ROOT, "docs/assets/budgets.json"));
const profiles = loadJson<ProfileFile>(join(ROOT, "docs/assets/load-profiles.json"));
const profile: LoadProfile | undefined = profiles[budgets.profile];
if (!profile) {
  console.error(`budgets.json references unknown profile '${budgets.profile}'`);
  process.exit(2);
}
const loadProfile: LoadProfile = profile;

function argValue(flag: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3) : fallback;
}

const geometry = argValue("geometry", "meshopt") as GeometryCodec;
const trials = Number(argValue("trials", "200"));
const seed = Number(argValue("seed", "1"));

async function build(): Promise<void> {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`no source directory: ${SOURCE_DIR} (run 'bun run assets:sample')`);
    process.exit(2);
  }
  const generatedAt = new Date().toISOString();
  const result = await runPipeline({
    sourceDir: SOURCE_DIR,
    outDir: OUT_DIR,
    budgets,
    profile: loadProfile,
    generatedAt,
    geometry,
    trials,
    seed,
  });
  const report = buildReportArtifact(
    result,
    { ticket: TICKET, profile: loadProfile.name, geometry, generatedAt },
    budgets.perAsset,
  );
  const text = formatReportText(report, result);
  const { txtPath } = writeReportArtifacts(EVIDENCE_DIR, report, text);
  console.log(text);
  console.log(`evidence: ${txtPath}`);
  if (!report.ok) {
    console.error("BUILD FAILED: asset budget or load gate violated");
    process.exit(1);
  }
}

function check(): void {
  const manifestPath = join(OUT_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${manifestPath} — run 'bun run assets:build' first`);
    process.exit(2);
  }
  const manifest = readManifest(manifestPath);
  const budget = checkBudget(manifest, budgets);
  const load = simulateColdStart(manifest, loadProfile, budgets.coldStartMs, {
    trials,
    seed,
  });
  console.log(
    `budget=${budget.ok ? "PASS" : "FAIL"} load=${load.ok ? "PASS" : "FAIL"} ` +
      `total=${manifest.totals.bytes}B p95=${load.p95Ms.toFixed(1)}ms`,
  );
  if (!budget.ok || !load.ok) {
    for (const v of budget.violations) console.error(`! ${v.message}`);
    process.exit(1);
  }
}

const cmd = process.argv[2] ?? "build";
if (cmd === "build") {
  await build();
} else if (cmd === "check") {
  check();
} else {
  console.error(`unknown command '${cmd}' (expected 'build' or 'check')`);
  process.exit(2);
}
