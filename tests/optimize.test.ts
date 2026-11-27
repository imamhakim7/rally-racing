import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeKtx2, optimizeGlb, readGlb } from "../src/assets/optimize.ts";

const SOURCE = join(process.cwd(), "assets/source");
const contains = (bytes: Uint8Array, needle: string) =>
  Buffer.from(bytes).includes(needle);

const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe("optimizeGlb", () => {
  const sourceGlb = () => new Uint8Array(readFileSync(join(SOURCE, "gate-arch.glb")));

  it("produces a valid meshopt + KTX2 GLB", async () => {
    const out = await optimizeGlb(sourceGlb(), { geometry: "meshopt" });
    expect(contains(out, "EXT_meshopt_compression")).toBe(true);
    expect(contains(out, "KHR_texture_basisu")).toBe(true);

    const doc = await readGlb(out, "meshopt");
    const primitive = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    // 3 boxes × 24 verts / 36 indices, preserved through compression.
    expect(primitive.getAttribute("POSITION")!.getCount()).toBe(72);
    expect(primitive.getIndices()!.getCount()).toBe(108);
    expect(doc.getRoot().listTextures()[0]!.getMimeType()).toBe("image/ktx2");
  });

  it("produces a valid Draco + KTX2 GLB when requested", async () => {
    const out = await optimizeGlb(sourceGlb(), { geometry: "draco" });
    expect(contains(out, "KHR_draco_mesh_compression")).toBe(true);
    expect(contains(out, "KHR_texture_basisu")).toBe(true);

    const doc = await readGlb(out, "draco");
    const primitive = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    expect(primitive.getAttribute("POSITION")!.getCount()).toBe(72);
  });

  it("is deterministic for the same input and options", async () => {
    const a = await optimizeGlb(sourceGlb(), { geometry: "meshopt" });
    const b = await optimizeGlb(sourceGlb(), { geometry: "meshopt" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("encodeKtx2", () => {
  it("emits KTX2 magic bytes for a PNG texture", async () => {
    const png = new Uint8Array(readFileSync(join(SOURCE, "tarmac.png")));
    const ktx2 = await encodeKtx2(png);
    expect([...ktx2.slice(0, 12)]).toEqual(KTX2_MAGIC);
  });
});
