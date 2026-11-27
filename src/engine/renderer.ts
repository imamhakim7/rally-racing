import * as THREE from "three";

/**
 * Minimal rendering surface the engine depends on. `createRenderer` returns the
 * real WebGL implementation; tests inject a fake so the app/scene lifecycle can
 * be verified headlessly (no GL context required).
 */
export interface RendererHandle {
  readonly domElement: HTMLCanvasElement;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Resize the drawing buffer to CSS pixels × devicePixelRatio. */
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** The engine requires WebGL2 — no WebGL1 fallback (three.js dropped it in r163). */
export function getWebGL2Context(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  }) as WebGL2RenderingContext | null;
}

export interface CreateRendererOptions {
  /** Cap the device pixel ratio to protect the frame budget. Defaults to 2. */
  maxPixelRatio?: number;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): RendererHandle {
  const context = getWebGL2Context(canvas);
  if (!context) {
    throw new Error(
      "Apex Rally needs a WebGL2 context, but the canvas could not create one.",
    );
  }

  const maxPixelRatio = options.maxPixelRatio ?? 2;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return {
    domElement: canvas,
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
