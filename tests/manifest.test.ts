import { describe, expect, it } from "vitest";
import {
  buildManifest,
  finalizeAsset,
  readManifest,
  writeManifest,
} from "../src/assets/manifest.ts";
import { CACHE_CONTROL_IMMUTABLE } from "../src/assets/formats.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("finalizeAsset", () => {
  it("content-addresses the URL and sets immutable cache headers", () => {
    const { record } = finalizeAsset({
      logicalName: "gate-arch",
      kind: "model",
      ext: "glb",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(record.url).toMatch(/^\/assets\/models\/gate-arch\.[0-9a-f]{8}\.glb$/);
    expect(record.bytes).toBe(4);
    expect(record.contentType).toBe("model/gltf-binary");
    expect(record.cacheControl).toBe(CACHE_CONTROL_IMMUTABLE);
  });

  it("serves textures and audio from their own directories", () => {
    expect(
      finalizeAsset({ logicalName: "road", kind: "texture", ext: "ktx2", bytes: new Uint8Array([9]) })
        .record.url,
    ).toMatch(/^\/assets\/textures\/road\./);
    expect(
      finalizeAsset({ logicalName: "wind", kind: "audio", ext: "wav", bytes: new Uint8Array([9]) })
        .record.url,
    ).toMatch(/^\/assets\/audio\/wind\./);
  });
});

describe("buildManifest", () => {
  it("computes totals by kind and sorts by logical name", () => {
    const a = finalizeAsset({ logicalName: "z-model", kind: "model", ext: "glb", bytes: new Uint8Array(10) }).record;
    const b = finalizeAsset({ logicalName: "a-tex", kind: "texture", ext: "ktx2", bytes: new Uint8Array(5) }).record;
    const manifest = buildManifest([a, b], "1970-01-01T00:00:00.000Z");
    expect(manifest.assets.map((x) => x.logicalName)).toEqual(["a-tex", "z-model"]);
    expect(manifest.totals).toEqual({
      bytes: 15,
      count: 2,
      byKind: { texture: 5, model: 10 },
    });
  });

  it("round-trips through disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    const path = join(dir, "manifest.json");
    const manifest = buildManifest(
      [finalizeAsset({ logicalName: "x", kind: "model", ext: "glb", bytes: new Uint8Array(3) }).record],
      "1970-01-01T00:00:00.000Z",
    );
    writeManifest(path, manifest);
    expect(readManifest(path)).toEqual(manifest);
  });
});
