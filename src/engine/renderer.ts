import * as THREE from "three";
import { QUALITY_PRESETS, type QualityPreset } from "./capabilities";

/**
 * Minimal rendering surface the engine depends on. `createRenderer` returns the
 * real WebGL implementation; tests inject a fake so the app/scene lifecycle can
 * be verified headlessly (no GL context required).
 */
export interface RendererHandle {
  readonly domElement: HTMLCanvasElement;
  /** The preset the renderer was created with (diagnostics/evidence). */
  readonly quality?: QualityPreset;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Resize the drawing buffer to CSS pixels × devicePixelRatio. */
  setSize(width: number, height: number): void;
  dispose(): void;
}

/**
 * The engine requires WebGL2 — no WebGL1 fallback (three.js dropped it in r163).
 * `antialias` is a **context-creation** attribute: a context created once on a
 * canvas cannot be re-requested with different attributes, so the quality preset
 * must decide it before the app canvas context exists (hence the boot probe).
 */
export function getWebGL2Context(
  canvas: HTMLCanvasElement,
  antialias = true,
): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    antialias,
    alpha: false,
    powerPreference: "high-performance",
  }) as WebGL2RenderingContext | null;
}

export interface CreateRendererOptions {
  /** Cap the device pixel ratio to protect the frame budget. Overrides `quality`. */
  maxPixelRatio?: number;
  /** Capability-derived quality preset (see `capabilities.ts`). */
  quality?: QualityPreset;
}

function buildRenderer(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
  options: CreateRendererOptions,
): RendererHandle {
  const quality = options.quality;
  const maxPixelRatio = options.maxPixelRatio ?? quality?.maxPixelRatio ?? 2;
  const antialias = quality?.antialias ?? true;

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxPixelRatio));
  renderer.shadowMap.enabled = quality ? quality.shadows !== false : true;
  renderer.shadowMap.type =
    quality?.shadows === "basic" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

  return {
    domElement: canvas,
    quality,
    render(scene, camera) {
      renderer.render(scene, camera);
    },
    setSize(width, height) {
      renderer.setSize(width, height, false);
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export type CreateRendererResult =
  | { ok: true; renderer: RendererHandle }
  | { ok: false; error: string };

/**
 * Non-throwing renderer factory for the boot path: a browser with no WebGL2 (or a
 * context that fails to initialize) yields `{ ok: false }` so `main.ts` can show
 * the graceful fallback screen instead of leaving a black canvas.
 */
export function tryCreateRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): CreateRendererResult {
  const antialias = options.quality?.antialias ?? true;
  let context: WebGL2RenderingContext | null = null;
  try {
    context = getWebGL2Context(canvas, antialias);
  } catch (error) {
    return { ok: false, error: `WebGL2 context creation threw: ${String(error)}` };
  }
  if (!context) {
    return { ok: false, error: "The canvas could not create a WebGL2 context." };
  }
  try {
    return { ok: true, renderer: buildRenderer(canvas, context, options) };
  } catch (error) {
    return { ok: false, error: `WebGL2 renderer construction failed: ${String(error)}` };
  }
}

/**
 * Create the renderer or throw. Kept for callers that require a context; the
 * browser boot path uses `tryCreateRenderer` for graceful degradation.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): RendererHandle {
  const result = tryCreateRenderer(canvas, options);
  if (!result.ok) {
    throw new Error(`Apex Rally needs a WebGL2 context: ${result.error}`);
  }
  return result.renderer;
}

/** Default preset settings, re-exported for callers/tests. */
export { QUALITY_PRESETS };
