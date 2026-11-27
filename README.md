# Apex Rally

A browser rally game built on [three.js](https://threejs.org/). A single canvas boots a
WebGL2 scene driven by a fixed-timestep game loop, with a drivable rally car and
surface-dependent grip.

## Quick start

```bash
bun install
bun run dev        # Vite dev server on http://localhost:5173
bun run build      # typecheck + production build into dist/
bun run test       # Vitest unit suite
bun run typecheck  # tsc --noEmit
bun run screenshot # build + headless Chromium screenshot into docs/evidence/
```

### Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake (and reverse from a standstill) |
| `A` / `D` / `←` / `→` | Steer left / right (speed-sensitive) |
| `Space` | Handbrake — flick the tail out for a drift |




## Engine bootstrap

The engine is deliberately tiny and deterministic: a **fixed-timestep loop** advances the
simulation in equal slices so physics and race logic are frame-rate independent and
reproducible, while rendering interpolates between the last two simulated states for
smooth motion.

### Module structure (`src/`)

| Module | Responsibility |
| --- | --- |
| `src/engine/loop.ts` | `FixedTimestepLoop` — accumulator + clamped delta, `update(dt)` at a fixed step, `render(alpha)` with interpolation. Clock and frame scheduler are injectable. |
| `src/engine/renderer.ts` | `createRenderer(canvas)` — WebGL2 `THREE.WebGLRenderer`, pixel-ratio clamp, `setSize`, `dispose`. Implements the `RendererHandle` port. |
| `src/engine/scene.ts` | `createPlaceholderScene()` — camera, lights, ground + grid and a placeholder "car"; `update`/`interpolate`/`resize`/`dispose` lifecycle. |
| `src/engine/app.ts` | `EngineApp` — composition root wiring loop ↔ scene ↔ renderer, resize handling, teardown and the headless `tick()`. |
| `src/engine/index.ts` | Barrel + `createEngine(canvas)` convenience factory. |
| `src/main.ts` | Browser entry: grabs the `#app` canvas, starts the engine, disposes on HMR. |

### The loop

`FixedTimestepLoop` keeps an accumulator:

```
elapsed   = min(elapsedSinceLastFrame, maxDelta)   // clamp: no spiral of death
accumulator += elapsed
while accumulator >= fixedDelta:                    // fixed, deterministic steps
    update(fixedDelta)
    accumulator -= fixedDelta
render(accumulator / fixedDelta)                    // alpha in [0,1) for interpolation
```

- `fixedDelta` defaults to `1/60` s; `maxDelta` defaults to `0.25` s.
- `tick(elapsedSeconds)` is the **headless entry point**: it runs the exact number of
  fixed steps for the elapsed time and returns that count — no `requestAnimationFrame`
  and no GL context required.
- `start()` / `stop()` drive the same `tick()` from `requestAnimationFrame`.
- `dispose()` stops the loop, disconnects the resize observer and releases the scene and
  renderer exactly once (idempotent).

### Lifecycle contract

| Hook | Guarantee |
| --- | --- |
| `EngineApp.start()` | Measures the canvas, subscribes to resize, starts scheduling. |
| `EngineApp.stop()` | Cancels scheduling; simulation state is preserved. |
| `EngineApp.dispose()` | Idempotent; disposes loop → scene (geometries/materials) → renderer, drops all listeners. |
| `SceneHandle.resize(w,h)` | Keeps camera aspect in sync; guards against zero-size canvases. |

### Verification

- `tests/loop.test.ts` — asserts the loop advances **exactly N fixed steps** for a given
  elapsed time, always steps by `fixedDelta`, interpolates in `[0,1)`, clamps long frames
  and is inert after `dispose()`.
- `tests/app.test.ts` — asserts the app drives N steps, resizes, and disposes the loop,
  scene and renderer exactly once.
- `tests/scene.test.ts` — asserts the placeholder scene builds, resizes and disposes every
  geometry/material once.
- `bun scripts/screenshot.mjs` — renders the built app in headless Chromium (SwiftShader
  WebGL2) and writes `docs/evidence/APEX-1-scene.png`.

### Design decisions

- **WebGL2 only.** three.js dropped WebGL1 in r163; the renderer fails fast with a clear
  message when no WebGL2 context is available rather than silently degrading.
- **Ports, not singletons.** `RendererHandle` / `SceneHandle` are interfaces so the whole
  app is exercised headlessly with fakes; only `createRenderer` touches a real GL context.
- **Interpolation lives in the scene.** The loop only produces `alpha`; each scene lerps
  its own transforms between the previous and current fixed state.

## Vehicle handling

The rally car is a single-track ("bicycle") model integrated in its own body frame at the
fixed step. Because the physics only ever sees the loop's fixed `dt`, handling is
frame-rate independent: a run driven at 30, 60 or 144 fps traces the identical path.

### Module structure (`src/physics/`)

| Module | Responsibility |
| --- | --- |
| `src/physics/pacejka.ts` | Simplified Pacejka magic formula — the tyre force curve (`F = peak·sin(shape·atan(stiffness·slip))`). |
| `src/physics/surface.ts` | Surface definitions (lateral + longitudinal grip, rolling resistance) for tarmac / gravel / mud / ice, plus a zone map. |
| `src/physics/vehicle.ts` | `Vehicle` — drive/brake/reverse, per-axle slip, yaw moment, speed-sensitive steering, handbrake drift, telemetry. |
| `src/physics/debug.ts` | DOM-free debug-HUD view-model (speed, slip, surface). |
| `src/input/keyboard.ts` | WASD / arrows / space → `VehicleInput`. |
| `src/ui/debugOverlay.ts` | Renders the HUD into an element next to the canvas. |
| `src/scenes/physicsTestScene.ts` | Drivable `SceneHandle` on the four-surface test track. |

### How it drives

- **Longitudinal.** Throttle drives, tapering to zero at top speed; the brake opposes the
  direction of travel and reverses from a standstill. Both scale with surface grip.
- **Lateral.** A simplified-Pacejka force per axle, peaked by surface lateral grip and the
  static axle load. The handbrake cuts the rear peak so the tail steps out; yaw damping and
  the restored rear grip let the car gather itself back up.
- **Steering.** Rate-limited toward `maxSteerAngle · input · 1/(1 + falloff·speed)`, so it is
  quick at rest and calm at speed.
- **Surfaces.** tarmac grips, gravel slides wider and brakes longer, mud is slow and loose,
  ice has almost no cornering authority.

### Verification

- `tests/pacejka.test.ts` — the tyre curve is odd, bounded by the peak, peaks at
  `pacejkaPeakSlip` and is monotonic up to it.
- `tests/surface.test.ts` — surfaces are ordered tarmac > gravel > mud > ice; the zone lookup
  and lane map resolve correctly.
- `tests/vehicle.test.ts` — acceleration, braking, reversing, no creep at rest,
  speed-sensitive steering and turn direction, handbrake drift + recovery, and the
  measurable per-surface differences (wider line, larger front slip, slower to turn, longer
  braking).
- `tests/framerate.test.ts` — the same input yields the same fixed-step count and pose at
  30 / 60 / 144 fps.
- `tests/debug.test.ts` / `tests/input.test.ts` / `tests/physicsTestScene.test.ts` — HUD
  formatting, key mapping, and scene build/step/surface/dispose lifecycle.
- `bun scripts/screenshot.mjs` — drives the built app in headless Chromium and writes
  `docs/evidence/APEX-2-scene.png` (gravel) and `docs/evidence/APEX-2-drift.png` (mud).
