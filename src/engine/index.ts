export { EngineApp, type EngineAppOptions } from "./app";
export { FixedTimestepLoop, type LoopCallbacks, type LoopOptions } from "./loop";
export { createRenderer, getWebGL2Context, type RendererHandle } from "./renderer";
export { createPlaceholderScene, type SceneHandle } from "./scene";

import { EngineApp, type EngineAppOptions } from "./app";
import { createRenderer, type RendererHandle } from "./renderer";
import { createPlaceholderScene } from "./scene";

export interface CreateEngineOptions {
  renderer?: Parameters<typeof createRenderer>[1];
  fixedDelta?: number;
  maxDelta?: number;
  now?: EngineAppOptions["now"];
  requestFrame?: EngineAppOptions["requestFrame"];
  cancelFrame?: EngineAppOptions["cancelFrame"];
  /** Escape hatch for tests: inject a fake renderer/scene. */
  rendererHandle?: RendererHandle;
  sceneHandle?: EngineAppOptions["sceneHandle"];
}

/**
 * Boot the engine against a single canvas: WebGL2 renderer + placeholder scene +
 * fixed-timestep loop. Call `start()` in the browser or `tick()` headlessly.
 */
export function createEngine(
  canvas: HTMLCanvasElement,
  options: CreateEngineOptions = {},
): EngineApp {
  const renderer = options.rendererHandle ?? createRenderer(canvas, options.renderer);
  const sceneHandle = options.sceneHandle ?? createPlaceholderScene();
  return new EngineApp({
    renderer,
    sceneHandle,
    fixedDelta: options.fixedDelta,
    maxDelta: options.maxDelta,
    now: options.now,
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });
}
