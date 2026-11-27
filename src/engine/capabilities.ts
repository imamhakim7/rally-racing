/**
 * WebGL2 capability detection, support assessment and quality presets.
 *
 * Pure and headless-testable: every function takes a (possibly fake) GL context
 * and optional device hints, so the boot decision can be unit-tested without a
 * real GPU. `main.ts` uses the result to either boot the game or mount the
 * graceful unsupported-browser screen — the renderer must never throw for a
 * browser we can detect as unsupported.
 */

export type SupportLevel = "full" | "reduced" | "unsupported";
export type QualityPresetId = "low" | "medium" | "high";

/** The minimal WebGL2 surface capability detection needs. A real
 * `WebGL2RenderingContext` structurally satisfies this. */
export interface CapabilityContext {
  readonly MAX_TEXTURE_SIZE: number;
  getSupportedExtensions(): readonly string[] | null;
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
}

export interface GlCapabilities {
  webgl2: boolean;
  /** Extension names reported by `getSupportedExtensions()` (never null). */
  extensions: string[];
  maxTextureSize: number;
  /** Unmasked GPU strings when `WEBGL_debug_renderer_info` is exposed. */
  vendor: string;
  renderer: string;
}

/** Optional device signals. Absence is *not* evidence of a weak device. */
export interface DeviceHints {
  /** `navigator.deviceMemory` in GB. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`. */
  hardwareConcurrency?: number;
}

export interface SupportAssessment {
  level: SupportLevel;
  /** One-line, human-readable summary of the verdict. */
  reason: string;
  /** Hard requirements that failed (non-empty iff `level === "unsupported"`). */
  missing: string[];
  /** Soft capabilities/device limits that lower the preset. */
  degraded: string[];
  preset: QualityPresetId;
}

export interface QualityPreset {
  id: QualityPresetId;
  /** Cap on `devicePixelRatio` (frame-budget protection). */
  maxPixelRatio: number;
  antialias: boolean;
  /** `false` disables shadow maps; `basic` = PCF, `soft` = PCFSoft. */
  shadows: false | "basic" | "soft";
  shadowMapSize: number;
  /** Cap for `texture.anisotropy` (owned by texture setup, exposed here). */
  anisotropy: number;
}

/** Any one of these lets the KTX2/Basis assets from #APEX-6 decode. */
export const COMPRESSED_TEXTURE_EXTENSIONS = [
  "WEBGL_compressed_texture_etc",
  "WEBGL_compressed_texture_s3tc",
  "WEBGL_compressed_texture_astc",
  "EXT_texture_compression_bptc",
] as const;

const ANISOTROPY_EXTENSION = "EXT_texture_filter_anisotropic";
const FLOAT_BUFFER_EXTENSION = "EXT_color_buffer_float";

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  high: { id: "high", maxPixelRatio: 2, antialias: true, shadows: "soft", shadowMapSize: 2048, anisotropy: 8 },
  medium: { id: "medium", maxPixelRatio: 1.5, antialias: true, shadows: "basic", shadowMapSize: 1024, anisotropy: 4 },
  low: { id: "low", maxPixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, anisotropy: 1 },
};

const UNSUPPORTED: SupportAssessment = {
  level: "unsupported",
  reason: "This browser or device does not provide WebGL2, which Apex Rally requires.",
  missing: ["WebGL2"],
  degraded: [],
  preset: "low",
};

/** A synthetic unsupported verdict for the `?forceUnsupported=1` evidence hook. */
export function forcedUnsupportedAssessment(
  reason = "WebGL2 is disabled by the forced-unsupported profile.",
): SupportAssessment {
  return { ...UNSUPPORTED, reason, missing: ["WebGL2"] };
}

/** Inspect a WebGL2 context. Never throws; a null context yields
 * `webgl2:false` with empty capability fields. */
export function detectCapabilities(gl: CapabilityContext | null): GlCapabilities {
  if (!gl) {
    return { webgl2: false, extensions: [], maxTextureSize: 0, vendor: "", renderer: "" };
  }

  let extensions: string[] = [];
  try {
    extensions = [...(gl.getSupportedExtensions() ?? [])];
  } catch {
    extensions = [];
  }

  let maxTextureSize = 0;
  try {
    maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
  } catch {
    maxTextureSize = 0;
  }

  let vendor = "unknown";
  let renderer = "unknown";
  try {
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_VENDOR_WEBGL: number;
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    if (debug) {
      vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? "unknown");
      renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? "unknown");
    }
  } catch {
    /* debug info is optional diagnostics only */
  }

  return { webgl2: true, extensions, maxTextureSize, vendor, renderer };
}

export function hasCompressedTextureSupport(caps: GlCapabilities): boolean {
  return COMPRESSED_TEXTURE_EXTENSIONS.some((id) => caps.extensions.includes(id));
}

/**
 * Verdict for a capability set. `unsupported` iff a hard requirement (WebGL2)
 * is missing; otherwise `full`, or `reduced` when a soft capability/device limit
 * is present. Deterministic for the same inputs.
 */
export function assessSupport(caps: GlCapabilities, hints: DeviceHints = {}): SupportAssessment {
  if (!caps.webgl2) return { ...UNSUPPORTED };

  const degraded: string[] = [];
  if (!hasCompressedTextureSupport(caps)) degraded.push("compressed-texture decoding (KTX2/Basis)");
  if (!caps.extensions.includes(FLOAT_BUFFER_EXTENSION)) degraded.push("float render targets");
  if (!caps.extensions.includes(ANISOTROPY_EXTENSION)) degraded.push("anisotropic texture filtering");

  const memory = hints.deviceMemory;
  const cpu = hints.hardwareConcurrency;
  const veryWeak = (memory !== undefined && memory <= 1) || (cpu !== undefined && cpu <= 1);
  const weak = (memory !== undefined && memory <= 2) || (cpu !== undefined && cpu <= 2);
  if (weak) degraded.push("limited device memory / CPU");

  const level: SupportLevel = degraded.length > 0 ? "reduced" : "full";
  const preset: QualityPresetId = veryWeak ? "low" : level === "full" ? "high" : "medium";

  const reason =
    level === "full"
      ? "WebGL2 and all recommended capabilities are available."
      : `Running with reduced quality: ${degraded.join(", ")} unavailable.`;

  return { level, reason, missing: [], degraded, preset };
}

/** Concrete renderer settings for an assessment's chosen preset. */
export function resolveQualityPreset(assessment: SupportAssessment): QualityPreset {
  return QUALITY_PRESETS[assessment.preset] ?? QUALITY_PRESETS.low;
}
