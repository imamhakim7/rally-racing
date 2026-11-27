import { FixedTimestepLoop, type LoopOptions } from "./loop";
import type { RendererHandle } from "./renderer";
import type { SceneHandle } from "./scene";

/**
 * Composition root for one running game instance. Owns the loop ↔ scene ↔
 * renderer wiring, resize handling and teardown. It can be driven entirely
 * headlessly through `tick(elapsedSeconds)` — no `requestAnimationFrame` and no
 * live GL context are needed for tests.
 */
export interface EngineAppOptions {
  renderer: RendererHandle;
  sceneHandle: SceneHandle;
  /** Seconds per simulation step (default 1/60). */
  fixedDelta?: number;
  /** Max elapsed time absorbed in one frame (seconds, default 0.25). */
  maxDelta?: number;
  /** Frame clock used by `start()` (defaults to performance.now). */
  now?: () => number;
  requestFrame?: LoopOptions["requestFrame"];
  cancelFrame?: LoopOptions["cancelFrame"];
  /**
   * Called once per fixed simulation step, after the scene update, with `dt`
   * equal to the fixed delta. Lets non-scene systems (e.g. the race loop) share
   * the same deterministic clock. Defaults to a no-op.
   */
  onUpdate?: (dt: number) => void;
  /** Called once per rendered frame, after interpolation. Defaults to a no-op. */
  onRender?: (alpha: number) => void;
}

export class EngineApp {
  readonly renderer: RendererHandle;
  readonly sceneHandle: SceneHandle;

  private readonly loop: FixedTimestepLoop;
  private resizeObserver: ResizeObserver | null = null;
  private windowListener: (() => void) | null = null;
  private disposed = false;

  constructor(options: EngineAppOptions) {
    this.renderer = options.renderer;
    this.sceneHandle = options.sceneHandle;
    this.loop = new FixedTimestepLoop(
      {
        update: (dt) => {
          this.sceneHandle.update(dt);
          options.onUpdate?.(dt);
        },
        render: (alpha) => {
          this.sceneHandle.interpolate(alpha);
          this.renderer.render(this.sceneHandle.scene, this.sceneHandle.camera);
          options.onRender?.(alpha);
        },
      },
      {
        fixedDelta: options.fixedDelta,
        maxDelta: options.maxDelta,
        now: options.now,
        requestFrame: options.requestFrame,
        cancelFrame: options.cancelFrame,
      },
    );
  }

  get running(): boolean {
    return this.loop.running;
  }

  /** Total fixed steps simulated across the app's lifetime. */
  get steps(): number {
    return this.loop.steps;
  }

  /** Current render interpolation factor in [0,1). */
  get alpha(): number {
    return this.loop.alpha;
  }

  /**
   * Advance by `elapsedSeconds` and render one frame. Headless/test entry point.
   * Returns the number of fixed simulation steps that ran.
   */
  tick(elapsedSeconds: number): number {
    if (this.disposed) return 0;
    return this.loop.tick(elapsedSeconds);
  }

  /** Start the rAF-driven loop and subscribe to canvas size changes. */
  start(): void {
    if (this.disposed || this.loop.running) return;
    this.resize();
    const target = this.renderer.domElement;
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(target);
    } else if (typeof window !== "undefined") {
      this.windowListener = () => this.resize();
      window.addEventListener("resize", this.windowListener);
    }
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** Measure the canvas and propagate the size to renderer + camera. */
  resize(): void {
    if (this.disposed) return;
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    this.renderer.setSize(width, height);
    this.sceneHandle.resize(width, height);
  }

  /** Stop the loop, drop listeners and release renderer + scene resources. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.windowListener && typeof window !== "undefined") {
      window.removeEventListener("resize", this.windowListener);
      this.windowListener = null;
    }
    this.sceneHandle.dispose();
    this.renderer.dispose();
  }
}
