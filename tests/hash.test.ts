import { describe, expect, it } from "vitest";
import { contentHash, hashedFileName, splitExt } from "../src/assets/hash.ts";

describe("contentHash", () => {
  it("is stable and 8 hex chars", () => {
    const a = contentHash(new TextEncoder().encode("hello"));
    const b = contentHash(new TextEncoder().encode("hello"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when a byte changes", () => {
    expect(contentHash(new Uint8Array([1, 2, 3]))).not.toBe(
      contentHash(new Uint8Array([1, 2, 4])),
    );
  });
});

describe("hashedFileName", () => {
  it("embeds the hash before the extension", () => {
    expect(hashedFileName("gate-arch", "1a2b3c4d", "glb")).toBe(
      "gate-arch.1a2b3c4d.glb",
    );
  });
});

describe("splitExt", () => {
  it("splits base and lower-cased extension", () => {
    expect(splitExt("gate-arch.GLB")).toEqual({ base: "gate-arch", ext: "glb" });
    expect(splitExt("tarmac.png")).toEqual({ base: "tarmac", ext: "png" });
  });

  it("handles no extension", () => {
    expect(splitExt("README")).toEqual({ base: "README", ext: "" });
  });
});
