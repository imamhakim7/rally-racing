import { readFileSync, writeFileSync } from "node:fs";
import { contentHash, hashedFileName } from "./hash.ts";
import {
  CACHE_CONTROL_IMMUTABLE,
  contentTypeFor,
  KIND_DIR,
} from "./formats.ts";
import type {
  AssetKind,
  AssetManifest,
  AssetRecord,
  ManifestTotals,
} from "./types.ts";

/** An optimized asset ready to be content-addressed. */
export interface BuiltAsset {
  logicalName: string;
  kind: AssetKind;
  /** Output extension without the dot, e.g. `glb`, `ktx2`. */
  ext: string;
  bytes: Uint8Array;
}

export interface FinalizedAsset {
  record: AssetRecord;
  bytes: Uint8Array;
}

/**
 * Hash an optimized asset and derive its content-addressed URL + cache headers.
 * `baseUrl` defaults to the CDN mount point `/assets`.
 */
export function finalizeAsset(
  built: BuiltAsset,
  baseUrl = "/assets",
): FinalizedAsset {
  const hash = contentHash(built.bytes);
  const fileName = hashedFileName(built.logicalName, hash, built.ext);
  const url = `${baseUrl}/${KIND_DIR[built.kind]}/${fileName}`;
  return {
    record: {
      logicalName: built.logicalName,
      url,
      hash,
      bytes: built.bytes.byteLength,
      kind: built.kind,
      contentType: contentTypeFor(built.ext),
      cacheControl: CACHE_CONTROL_IMMUTABLE,
    },
    bytes: built.bytes,
  };
}

function computeTotals(records: AssetRecord[]): ManifestTotals {
  const byKind: Partial<Record<AssetKind, number>> = {};
  let bytes = 0;
  for (const r of records) {
    bytes += r.bytes;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.bytes;
  }
  return { bytes, count: records.length, byKind };
}

/** Build a manifest from finalized records; output is sorted by logical name for determinism. */
export function buildManifest(
  records: AssetRecord[],
  generatedAt: string,
): AssetManifest {
  const sorted = [...records].sort((a, b) =>
    a.logicalName.localeCompare(b.logicalName),
  );
  return {
    schemaVersion: 1,
    generatedAt,
    assets: sorted,
    totals: computeTotals(sorted),
  };
}

export function writeManifest(path: string, manifest: AssetManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function readManifest(path: string): AssetManifest {
  return JSON.parse(readFileSync(path, "utf8")) as AssetManifest;
}
