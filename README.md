# Apex Rally

A browser rally game built on [three.js](https://threejs.org/). A single canvas boots a
WebGL2 scene driven by a fixed-timestep game loop, with a drivable rally car and
surface-dependent grip, and data-driven stage circuits built from JSON.

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

## Asset pipeline

The game ships large models, textures and audio, so assets go through a reproducible
pipeline that turns source files into **compressed, hashed, budget-checked runtime
bundles**. (Epic `2026-Q4-APEX-RALLY-APEX-02`, ticket **#APEX-6**.)

- **glTF** geometry with **meshopt** (default) or **Draco** compression.
- **KTX2 / Basis** textures.
- Content-addressed output names (`name.<sha256[:8]>.<ext>`) and long-lived
  `Cache-Control: public, max-age=31536000, immutable` CDN headers.
- A CI gate that **fails closed** when a per-asset or total load budget is exceeded.
- A throttled **Slow-4G cold-start** p50/p95 simulation.

```bash
bun run assets:sample   # generate the sample-stage sources
bun run assets:build    # source → assets/dist + manifest.json + evidence report
bun run assets:check    # CI budget gate (exits non-zero on a violation)
```

See **[docs/assets/asset-pipeline.md](docs/assets/asset-pipeline.md)** for the full pipeline
README — compression, the manifest contract, budgets, the throttled load model and the CI
workflow — and [`docs/openspecs/APEX-6.md`](docs/openspecs/APEX-6.md) for the openspec.

### Asset layout

| Path | What |
| --- | --- |
| `assets/source/` | Committed sample-stage sources. |
| `assets/dist/` | Built, content-addressed bundles (gitignored). |
| `docs/assets/` | Budgets, load profiles and the pipeline README. |
| `docs/evidence/` | CI budget report and verification output. |
| `src/assets/` | The pipeline implementation. |

## Stage circuits (data-driven)

A rally stage is a **JSON file**, not code. A centreline spline plus checkpoint gates,
surface zones, start/finish and a minimap path are loaded and built into the world with no
TypeScript changes. The loader is the single source of truth: the road mesh, gate
transforms, surface spans and minimap are all derived from the same sampled spline, so they
cannot disagree with the file. (#APEX-4, epic `2026-Q4-APEX-RALLY-APEX-02`.)

### Module structure (`src/stage/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Domain types: `StageCircuit`, `SplineDef`, `CheckpointSpec`, `SurfaceSpec`, `StageWorld`. |
| `schema.ts` | The declarative schema descriptor — every field, type and range in one place. |
| `errors.ts` | `StageValidationError` (`{ path, code }`) and `formatStageError`. |
| `validate.ts` | Schema walk + semantic checks (unique ids, ordering, surface coverage); collects **all** issues. |
| `spline.ts` | Catmull-Rom centreline, **arc-length** sampling, tangents/normals, corner detection, minimap projection. |
| `road.ts` | Road ribbon geometry (positions/normals/uvs/colour) from the spline; surface-span resolution. |
| `world.ts` | `buildStageWorld` — road, checkpoint/finish gantries, start line, bounds, minimap. |
| `loader.ts` / `library.ts` | `loadStage`/`parseStage`; `StageLibrary` reads the generated `data/index.ts` listing every stage JSON. |
| `scene.ts` / `select.ts` | `SceneHandle` adapter that swaps stages live; the small stage-select control. |
| `race-adapter.ts` | `toRaceStage` — the ordered gate shape the race loop (#APEX-3) consumes. |
| `data/*.json` | Six shipped circuits across six biomes. |

### The stage format (v1)

```jsonc
{
  "schemaVersion": 1,
  "id": "alpine-forest", "name": "Alpine Forest", "biome": "forest", "difficulty": 3,
  "start":  { "position": [0, 0, 0], "headingDeg": 34 },
  "finish": { "t": 1.0, "gate": { "width": 12, "height": 6 } },
  "spline": { "closed": false, "tension": 0.5, "points": [{ "x": 0, "y": 0, "z": 0 } /* ... */] },
  "road":   { "width": 9, "sampleStep": 2, "surface": "gravel", "bankingDeg": 0 },
  "checkpoints": [{ "id": "cp-crest", "name": "Forest Crest", "t": 0.2, "width": 11, "height": 6 }],
  "surfaces":    [{ "id": "sz-start", "surface": "tarmac", "from": 0.0, "to": 0.12, "grip": 1.0 }],
  "minimap":     { "color": "#5fbf7f", "path": "auto" }
}
```

- `t` is an **arc-length fraction** in `[0,1]`; equal steps are equal distances.
- Surface zones are half-open `[from, to)` spans that must tile `[0,1]` exactly.
- `minimap.path: "auto"` projects the centreline; an explicit `points` list overrides it.

### Add a stage (no code change)

1. Drop a valid JSON file into `src/stage/data/`.
2. Run `bun run dev` (or `bun run build`) — the pre-hook regenerates
   `src/stage/data/index.ts`, which statically imports every stage JSON.
3. Pick it from the stage select (or reload).

`StageLibrary` reads the generated index, so `src/stage/data/index.ts` is the only
generated file and it is committed. Regenerate it explicitly with
`bun run gen:stages`; `tests/stage-data-integrity.test.ts` fails loudly if the index and
the directory ever drift. (A generated static index is used instead of Vite's
`import.meta.glob` so the library resolves identically in the browser bundle, the dev
server and plain `bun`/`node` test runners.)

### Validate a stage

```bash
bun scripts/validate-stage.ts src/stage/data/alpine-forest.json   # OK alpine-forest — ...
bun scripts/validate-stage.ts path/to/broken.json                 # names every bad field, exit 1
```

The validator fails closed with a `StageValidationError` whose `path` points at the exact
field (`checkpoints[1].width`) and whose issue list contains *every* problem, not just the
first.

### Verification

- `tests/stage-validate.test.ts` — accepts valid stages, defaults optional fields, and names
  each corruption (`type`/`required`/`range`/`enum`/`unique`/`ordering`/`coverage`/`version`).
- `tests/stage-spline.test.ts` — arc-length parameterisation, normalised tangent frames,
  corner detection and minimap projection.
- `tests/stage-world.test.ts` — road vertex/width parity with the spline, gate count/order,
  surface spans tiling the road, upward unit-length road normals, bounds, minimap path and
  one-shot disposal.
- `tests/stage-loader.test.ts` — six bundled stages load and build, unknown ids fail, and
  the #APEX-3 gate shape is projected.
- `tests/stage-scene.test.ts` — the `SceneHandle` adapter swaps worlds live and disposes the
  previous one.
- `bun scripts/check-normals.ts` — asserts every shipped road has unit-length, upward
  normals (regression guard for the flat-stage normal defect).
- `bun scripts/screenshot-stage.mjs` — renders two stages through the real stage select in
  headless Chromium and writes `docs/evidence/APEX-4-stage-*.png`.
