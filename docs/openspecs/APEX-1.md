# APEX-1 — three.js Engine Bootstrap & Fixed-Timestep Game Loop

Epic: `2026-Q4-APEX-RALLY-APEX-01` — Race Core & Vehicle Handling.

## Problem

Apex Rally has no renderer bootstrap, no fixed-timestep loop and no scene lifecycle, so
nothing can be built, tuned or measured. Without a deterministic simulation step, vehicle
handling (#APEX-2) and the race loop (#APEX-3) cannot be developed or tested reproducibly.

## Goal

A single canvas boots a three.js WebGL2 scene with a fixed-timestep game loop, delta-time
interpolation and a testable start/stop lifecycle.

## Non-goals

- Vehicle physics / handling (#APEX-2) and the race state machine (#APEX-3).
- Audio (#APEX-6), asset pipeline, CI/CD (#APEX-5). Placeholder primitives only.

## Design

### Modules

- `src/engine/loop.ts` — `FixedTimestepLoop`: accumulator + clamped delta; `update(dt)` at
  a fixed step; `render(alpha)` with an interpolation factor. Clock and frame scheduler are
  injectable so tests are headless.
- `src/engine/renderer.ts` — `createRenderer(canvas)`: WebGL2 `THREE.WebGLRenderer`,
  pixel-ratio clamp, `setSize()`, `dispose()`; implements the `RendererHandle` port.
- `src/engine/scene.ts` — `createPlaceholderScene()`: camera, lights, ground + grid and a
  placeholder "car"; `SceneHandle` with `update`/`interpolate`/`resize`/`dispose`.
- `src/engine/app.ts` — `EngineApp`: composes loop + renderer + scene; owns resize,
  `start()`/`stop()` and the headless `tick()`.
- `src/engine/index.ts` — barrel + `createEngine(canvas)` factory.
- `src/main.ts` — browser entry: binds `#app`, starts, disposes on HMR.

### Interfaces

```ts
interface LoopCallbacks { update(dt: number): void; render(alpha: number): void }
interface LoopOptions { fixedDelta?: number; maxDelta?: number } // defaults 1/60, 0.25

class FixedTimestepLoop {
  tick(elapsedSeconds: number): number  // fixed steps run; headless entry point
  get alpha(): number                    // [0,1)
  get steps(): number
  start(): void; stop(): void; dispose(): void
}

interface RendererHandle {
  readonly domElement: HTMLCanvasElement;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}
```

### Invariants

1. `tick(t)` runs `floor(min(t, maxDelta) / fixedDelta)` update steps (± 1e-9 fp epsilon).
2. Every update step is exactly `fixedDelta`. `alpha` is always in `[0,1)`.
3. A single frame absorbs at most `maxDelta` so a stall cannot spiral.
4. `dispose()` is idempotent: loop stopped, scene + renderer disposed exactly once.
5. No simulation or rendering occurs before `start()`/`tick()`.

### Edge cases

- Backgrounded tab / long pause: raw delta clamped to `maxDelta`.
- `elapsedSeconds <= 0` or non-finite: 0 steps, no NaN.
- Zero-size canvas: resize falls back to 1×1 (no divide-by-zero in aspect).
- Double `start()` / `dispose()`: no duplicate rAF, listeners or disposals.

## Acceptance criteria (Given/When/Then)

- **AC1** Given `fixedDelta=1/60` and `maxDelta>=1`, When `tick(1.0)`, Then exactly **60**
  update steps run and `alpha === 0`.
- **AC2** Given `fixedDelta=1/60`, When `tick(0.5)` twice, Then 30 + 30 steps and
  interpolation `alpha` in `[0,1)`; every step is exactly `fixedDelta`.
- **AC3** Given `maxDelta=0.25`, When `tick(10)`, Then **15** steps (clamped; no 600-step
  spiral).
- **AC4** Given a started app, When `dispose()` is called (even twice), Then loop, scene and
  renderer are each disposed exactly once and later `tick()` is a no-op.
- **AC5** Given the built app served over HTTP, When rendered in headless Chromium, Then a
  screenshot shows the placeholder scene (ground + grid + car) via a live WebGL2 context.

## How to test

- Vitest: `tests/loop.test.ts`, `tests/app.test.ts`, `tests/scene.test.ts` (fake clock and
  fake `RendererHandle` spies, real three.js objects).
- Screenshot: `bun run build && bun scripts/screenshot.mjs` → `docs/evidence/APEX-1-scene.png`.
- Gates: `bun run typecheck` and `bun run test` must be green; evidence attached to the ticket.

## Evidence

- `tests` run output (16 passed), `tsc --noEmit` clean, `vite build` success.
- `docs/evidence/APEX-1-scene.png` — 1280×720, WebGL2 (`Renderer: WebKit WebGL`), 564
  distinct colours with the red car and green ground visible.
