import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EngineApp } from "../src/engine/app";
import type { RendererHandle } from "../src/engine/renderer";
import type { SceneHandle } from "../src/engine/scene";

function makeCanvas(): HTMLCanvasElement {
  return { clientWidth: 800, clientHeight: 600, width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

function makeRenderer(canvas: HTMLCanvasElement = makeCanvas()) {
  const renderer: RendererHandle = {
    domElement: canvas,
    render: vi.fn(),
    setSize: vi.fn(),
    dispose: vi.fn(),
  };
  return renderer;
}

function makeSceneHandle() {
  const handle: SceneHandle = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    update: vi.fn(),
    interpolate: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return handle;
}

describe("EngineApp", () => {
  it("drives the scene and renderer for exactly N fixed steps (AC1/AC2)", () => {
    const renderer = makeRenderer();
    const sceneHandle = makeSceneHandle();
    const app = new EngineApp({ renderer, sceneHandle, fixedDelta: 1 / 60, maxDelta: 1 });

    expect(app.tick(1.0)).toBe(60);

    expect(sceneHandle.update).toHaveBeenCalledTimes(60);
    expect(sceneHandle.interpolate).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(sceneHandle.scene, sceneHandle.camera);
    expect(app.steps).toBe(60);
  });

  it("disposes the loop, scene and renderer exactly once (AC4)", () => {
    const renderer = makeRenderer();
    const sceneHandle = makeSceneHandle();
    const app = new EngineApp({ renderer, sceneHandle });

    app.tick(0.5);
    app.dispose();
    app.dispose(); // idempotent — no double free

    expect(app.running).toBe(false);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(sceneHandle.dispose).toHaveBeenCalledTimes(1);
    // A disposed app no longer simulates or draws.
    expect(app.tick(1)).toBe(0);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("starts and stops scheduling through the injected frame clock (AC4)", () => {
    const renderer = makeRenderer();
    const sceneHandle = makeSceneHandle();
    const scheduled: Array<(t: number) => void> = [];
    const cancelled: number[] = [];
    let clock = 0;
    const app = new EngineApp({
      renderer,
      sceneHandle,
      fixedDelta: 1 / 60,
      maxDelta: 1,
      now: () => clock,
      requestFrame: (cb) => {
        scheduled.push(cb);
        return scheduled.length;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });

    app.start();
    expect(app.running).toBe(true);
    // Initial resize propagates to renderer + camera.
    expect(renderer.setSize).toHaveBeenCalledWith(800, 600);
    expect(sceneHandle.resize).toHaveBeenCalledWith(800, 600);

    clock += 1000;
    scheduled[0]?.(clock); // one second of frames at the fixed step
    expect(sceneHandle.update).toHaveBeenCalledTimes(60);

    app.stop();
    expect(app.running).toBe(false);
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("guards resize against a zero-sized canvas", () => {
    const zeroCanvas = {
      clientWidth: 0,
      clientHeight: 0,
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    const renderer = makeRenderer(zeroCanvas);
    const sceneHandle = makeSceneHandle();
    const app = new EngineApp({ renderer, sceneHandle });

    app.resize();

    expect(renderer.setSize).toHaveBeenCalledWith(1, 1);
    expect(sceneHandle.resize).toHaveBeenCalledWith(1, 1);
  });
});
