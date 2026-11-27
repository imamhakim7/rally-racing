import { describe, expect, it } from "vitest";
import {
  COMPRESSED_TEXTURE_EXTENSIONS,
  QUALITY_PRESETS,
  assessSupport,
  detectCapabilities,
  forcedUnsupportedAssessment,
  hasCompressedTextureSupport,
  resolveQualityPreset,
  type CapabilityContext,
} from "../src/engine/capabilities";

const FULL_EXTENSIONS = [
  "WEBGL_compressed_texture_etc",
  "EXT_color_buffer_float",
  "EXT_texture_filter_anisotropic",
];

function fakeContext(options: {
  extensions?: readonly string[] | null;
  maxTextureSize?: number;
  vendor?: unknown;
  renderer?: unknown;
} = {}): CapabilityContext {
  const extensions = options.extensions === undefined ? FULL_EXTENSIONS : options.extensions;
  return {
    MAX_TEXTURE_SIZE: options.maxTextureSize ?? 8192,
    getSupportedExtensions: () => extensions,
    getExtension: (name) =>
      name === "WEBGL_debug_renderer_info"
        ? { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }
        : null,
    getParameter: (pname) => {
      if (pname === 0x9245) return options.vendor ?? "Acme Inc.";
      if (pname === 0x9246) return options.renderer ?? "Acme GPU 9000";
      return options.maxTextureSize ?? 8192;
    },
  };
}

describe("detectCapabilities (AC1)", () => {
  it("returns webgl2:false and empty fields for a null context without throwing", () => {
    expect(() => detectCapabilities(null)).not.toThrow();
    expect(detectCapabilities(null)).toEqual({
      webgl2: false,
      extensions: [],
      maxTextureSize: 0,
      vendor: "",
      renderer: "",
    });
  });

  it("reads extensions, max texture size and unmasked GPU strings", () => {
    const caps = detectCapabilities(fakeContext({ extensions: ["A", "B"], maxTextureSize: 4096 }));
    expect(caps.webgl2).toBe(true);
    expect(caps.extensions).toEqual(["A", "B"]);
    expect(caps.maxTextureSize).toBe(4096);
    expect(caps.vendor).toBe("Acme Inc.");
    expect(caps.renderer).toBe("Acme GPU 9000");
  });

  it("tolerates a null extension list (lost context) and a throwing getParameter", () => {
    const caps = detectCapabilities(fakeContext({ extensions: null }));
    expect(caps.webgl2).toBe(true);
    expect(caps.extensions).toEqual([]);

    const throwing: CapabilityContext = {
      MAX_TEXTURE_SIZE: 0,
      getSupportedExtensions: () => {
        throw new Error("lost");
      },
      getExtension: () => null,
      getParameter: () => {
        throw new Error("lost");
      },
    };
    expect(() => detectCapabilities(throwing)).not.toThrow();
    expect(detectCapabilities(throwing).extensions).toEqual([]);
  });
});

describe("assessSupport (AC2/AC3)", () => {
  it("is unsupported iff WebGL2 is missing", () => {
    const assessment = assessSupport(detectCapabilities(null));
    expect(assessment.level).toBe("unsupported");
    expect(assessment.missing).toEqual(["WebGL2"]);
    expect(assessment.preset).toBe("low");

    const supported = assessSupport(detectCapabilities(fakeContext()));
    expect(supported.missing).toEqual([]);
    expect(supported.level).not.toBe("unsupported");
  });

  it("is full/high when all recommended capabilities are present", () => {
    const assessment = assessSupport(detectCapabilities(fakeContext()));
    expect(assessment.level).toBe("full");
    expect(assessment.degraded).toEqual([]);
    expect(assessment.preset).toBe("high");
  });

  it("degrades to reduced/medium when a soft capability is missing", () => {
    for (const extensions of [
      ["EXT_color_buffer_float", "EXT_texture_filter_anisotropic"], // no compressed
      ["WEBGL_compressed_texture_etc", "EXT_texture_filter_anisotropic"], // no float
      ["WEBGL_compressed_texture_etc", "EXT_color_buffer_float"], // no anisotropic
    ]) {
      const assessment = assessSupport(detectCapabilities(fakeContext({ extensions })));
      expect(assessment.level).toBe("reduced");
      expect(assessment.preset).toBe("medium");
      expect(assessment.degraded.length).toBeGreaterThan(0);
    }
  });

  it("degrades when the device is weak, and to low when very weak", () => {
    const weak = assessSupport(detectCapabilities(fakeContext()), { deviceMemory: 2 });
    expect(weak.level).toBe("reduced");
    expect(weak.preset).toBe("medium");

    const veryWeak = assessSupport(detectCapabilities(fakeContext()), { hardwareConcurrency: 1 });
    expect(veryWeak.preset).toBe("low");
  });

  it("does not treat missing device hints as a weak device", () => {
    expect(assessSupport(detectCapabilities(fakeContext()), {}).preset).toBe("high");
  });

  it("is deterministic for identical input", () => {
    const caps = detectCapabilities(fakeContext({ extensions: ["EXT_color_buffer_float"] }));
    expect(assessSupport(caps)).toEqual(assessSupport(caps));
  });

  it("presets are monotonic in capability (unsupported <= reduced <= full)", () => {
    const order = { low: 0, medium: 1, high: 2 } as const;
    const unsupported = assessSupport(detectCapabilities(null)).preset;
    const reduced = assessSupport(detectCapabilities(fakeContext({ extensions: [] }))).preset;
    const full = assessSupport(detectCapabilities(fakeContext())).preset;
    expect(order[unsupported]).toBeLessThanOrEqual(order[reduced]);
    expect(order[reduced]).toBeLessThanOrEqual(order[full]);
  });
});

describe("hasCompressedTextureSupport", () => {
  it("accepts any known compressed format and rejects none", () => {
    for (const id of COMPRESSED_TEXTURE_EXTENSIONS) {
      expect(hasCompressedTextureSupport(detectCapabilities(fakeContext({ extensions: [id] })))).toBe(true);
    }
    expect(hasCompressedTextureSupport(detectCapabilities(fakeContext({ extensions: [] })))).toBe(false);
  });
});

describe("resolveQualityPreset (AC3)", () => {
  it("maps each preset id to concrete, decreasing settings", () => {
    expect(resolveQualityPreset({ level: "full", reason: "", missing: [], degraded: [], preset: "high" })).toEqual(
      QUALITY_PRESETS.high,
    );
    expect(QUALITY_PRESETS.high.maxPixelRatio).toBeGreaterThanOrEqual(QUALITY_PRESETS.medium.maxPixelRatio);
    expect(QUALITY_PRESETS.medium.maxPixelRatio).toBeGreaterThanOrEqual(QUALITY_PRESETS.low.maxPixelRatio);
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
  });

  it("falls back to the low preset for an unknown id", () => {
    const preset = resolveQualityPreset({
      level: "unsupported",
      reason: "",
      missing: [],
      degraded: [],
      preset: "nonsense" as never,
    });
    expect(preset).toBe(QUALITY_PRESETS.low);
  });
});

describe("forcedUnsupportedAssessment", () => {
  it("produces an unsupported verdict with a synthetic reason and the low preset", () => {
    const assessment = forcedUnsupportedAssessment();
    expect(assessment.level).toBe("unsupported");
    expect(assessment.missing).toEqual(["WebGL2"]);
    expect(assessment.reason).toMatch(/forced-unsupported/);
    expect(resolveQualityPreset(assessment)).toBe(QUALITY_PRESETS.low);
  });
});
