import { describe, expect, it } from "vitest";
import { createRenderer, getWebGL2Context, tryCreateRenderer } from "../src/engine/renderer";
import { QUALITY_PRESETS, type QualityPreset } from "../src/engine/capabilities";

function canvasWithoutWebgl2(): HTMLCanvasElement {
  return { getContext: () => null } as unknown as HTMLCanvasElement;
}

function recordingCanvas(): { canvas: HTMLCanvasElement; attributes: WebGLContextAttributes[] } {
  const attributes: WebGLContextAttributes[] = [];
  const canvas = {
    getContext: (_type: string, attrs?: WebGLContextAttributes) => {
      attributes.push(attrs ?? {});
      return null;
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, attributes };
}

describe("renderer graceful failure (AC2)", () => {
  it("tryCreateRenderer returns ok:false instead of throwing when WebGL2 is unavailable", () => {
    const result = tryCreateRenderer(canvasWithoutWebgl2(), { quality: QUALITY_PRESETS.high });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/WebGL2/i);
  });

  it("tryCreateRenderer returns ok:false when context creation throws", () => {
    const canvas = {
      getContext: () => {
        throw new Error("gpu process crashed");
      },
    } as unknown as HTMLCanvasElement;
    const result = tryCreateRenderer(canvas);
    expect(result.ok).toBe(false);
  });

  it("createRenderer still throws for callers that require a context", () => {
    expect(() => createRenderer(canvasWithoutWebgl2())).toThrow(/WebGL2/i);
  });

  it("forwards the preset antialias flag into context creation (attributes are fixed at creation)", () => {
    const direct = recordingCanvas();
    getWebGL2Context(direct.canvas, false);
    expect(direct.attributes[0]?.antialias).toBe(false);

    const viaTry = recordingCanvas();
    tryCreateRenderer(viaTry.canvas, { quality: QUALITY_PRESETS.low });
    expect(viaTry.attributes[0]?.antialias).toBe(false);

    const high = recordingCanvas();
    tryCreateRenderer(high.canvas, { quality: QUALITY_PRESETS.high });
    expect(high.attributes[0]?.antialias).toBe(true);
  });
});

describe("quality preset shape (AC3)", () => {
  it("exposes a renderer-consumable preset per id", () => {
    const ids = ["low", "medium", "high"] as const;
    for (const id of ids) {
      const preset: QualityPreset = QUALITY_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.maxPixelRatio).toBeGreaterThan(0);
      expect(typeof preset.antialias).toBe("boolean");
    }
    expect(QUALITY_PRESETS.high.shadows).toBe("soft");
    expect(QUALITY_PRESETS.medium.shadows).toBe("basic");
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
  });
});
