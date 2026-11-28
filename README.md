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

## Supported browsers

Apex Rally requires **WebGL2**. At boot the app detects WebGL2 and the extensions the
renderer and KTX2 assets need, chooses a quality preset from the detected capability, and
— when the browser cannot run the game — shows an **actionable unsupported-browser screen**
instead of a black canvas (`?forceUnsupported=1` shows it on demand for testing).

| Engine | Version floor | WebGL2 | Typical preset | Fallback when unsupported |
| --- | --- | --- | --- | --- |
| Chromium (Chrome / Edge) | 56+ | Required | `high` (ratio 2, soft shadows) | Actionable screen (update browser, enable hardware acceleration) |
| Firefox | 51+ | Required | `high` on a GPU, `medium`/`low` on a weak device | Actionable screen (WebGL2/GPU unavailable, e.g. headless or blocked GPU) |
| WebKit (Safari) | 16+ (Safari 15 WebGL2 is off by default) | Required | `high` | Actionable screen (enable WebGL / update Safari) |
| Any browser/device without WebGL2 | — | Missing | n/a | **Unsupported-browser screen** — no game loop, no thrown error |

Preset selection (`src/engine/capabilities.ts`):

- `high` — WebGL2 + compressed-texture support, float render targets and anisotropic
  filtering, on a device with adequate memory/CPU.
- `medium` — a recommended capability is missing, or the device is weak
  (`navigator.deviceMemory <= 2` or `hardwareConcurrency <= 2`): pixel ratio 1.5, PCF
  shadows, anisotropy 4.
- `low` — a very weak device (`<= 1`): pixel ratio 1, no shadows, no antialias.

Run the cross-engine smoke (Chromium / Firefox / WebKit) with
`bun run build && xvfb-run -a bun run smoke:browsers`; it writes machine-readable results
to `docs/evidence/APEX-14-smoke.json` and a fallback screenshot to
`docs/evidence/APEX-14-fallback.png`.

## Engine bootstrap

The engine is deliberately tiny and deterministic: a **fixed-timestep loop** advances the
simulation in equal slices so physics and race logic are frame-rate independent and
reproducible, while rendering interpolates between the last two simulated states for
smooth motion.

### Module structure (`src/`)

| Module | Responsibility |
| --- | --- |
| `src/engine/loop.ts` | `FixedTimestepLoop` — accumulator + clamped delta, `update(dt)` at a fixed step, `render(alpha)` with interpolation. Clock and frame scheduler are injectable. |
| `src/engine/capabilities.ts` | `detectCapabilities(gl)` / `assessSupport(caps, hints)` / `resolveQualityPreset(assessment)` — pure WebGL2 capability detection, support verdict and quality presets. |
| `src/engine/renderer.ts` | `createRenderer(canvas, { quality })` — WebGL2 `THREE.WebGLRenderer`, pixel-ratio clamp, `setSize`, `dispose`; `tryCreateRenderer` returns a result instead of throwing for graceful fallback. |
| `src/engine/scene.ts` | `createPlaceholderScene()` — camera, lights, ground + grid and a placeholder "car"; `update`/`interpolate`/`resize`/`dispose` lifecycle. |
| `src/engine/app.ts` | `EngineApp` — composition root wiring loop ↔ scene ↔ renderer, resize handling, teardown and the headless `tick()`. |
| `src/engine/index.ts` | Barrel + `createEngine(canvas)` convenience factory. |
| `src/ui/supportScreen.ts` | `supportScreenContent()` + `mountSupportScreen()` — the actionable unsupported-browser screen. |
| `src/main.ts` | Browser entry: detects capability, mounts the fallback or boots the engine with a quality preset, disposes on HMR. |

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

- **WebGL2 only, but never a black canvas.** three.js dropped WebGL1 in r163, so there is
  no WebGL1 fallback path. Instead the boot detects WebGL2 and its required extensions,
  degrades the quality preset to the detected capability, and shows an actionable
  unsupported-browser screen when the context is missing (see
  [Supported browsers](#supported-browsers)) — the renderer is no longer allowed to throw
  into the boot path.
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
| `world.ts` | `buildStageWorld` — terrain, road, checkpoint/finish gantries, start line, bounds, minimap. |
| `terrain.ts` | `buildTerrain` — deterministic per-biome heightfield, material, draw/triangle budget, lighting seam. |
| `containment.ts` | `createContainment` — soft roadside barrier that keeps a car on the road corridor. |
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
  "terrain":     { "seed": 1337, "relief": 7, "resolution": 15, "surface": "grass", "corridorWidth": 36 },
  "minimap":     { "color": "#5fbf7f", "path": "auto" }
}
```

- `t` is an **arc-length fraction** in `[0,1]`; equal steps are equal distances.
- Surface zones are half-open `[from, to)` spans that must tile `[0,1]` exactly.
- `terrain` (optional, #APEX-28) seeds the deterministic heightfield around the road; when
  omitted it is defaulted from the stage id, so every stage still renders ground.
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

### Terrain & roadside containment (#APEX-28)

`buildStageWorld` also builds a **terrain ribbon** from the same sampled spline, using the
`terrain` block plus the `BIOME_TERRAIN` lookup table (no per-biome code branch): a
deterministic value-noise heightfield banks up to the corridor edge, painted with the biome's
ground→ridge colours. Inside the road half-width the ground sits just below the ribbon, so it
never pokes through. Each stage is checked against `TERRAIN_BUDGET` (triangles/draw calls) for
both `midday` and `dusk`; geometry is time-of-day invariant, and `terrainLighting(timeOfDay)`
is the seam #APEX-29's sky/weather will drive.

A **soft containment barrier** (`StageWorld.containment`) projects a car onto the corridor
(`road.width/2 + 4 m` shoulder) when it runs wide, zeroes its lateral velocity and bleeds off
speed — used by the visible CPU race (#APEX-7) and reusable for any player `Vehicle` (#APEX-2).

```bash
bun scripts/screenshot-terrain.mjs   # per-stage terrain stats + screenshots, headless Chromium
```

- `tests/stage-terrain.test.ts` — all six stages build distinct, biome-specific terrain; the
  heightfield is deterministic per seed; budget passes at midday and dusk.
- `tests/stage-containment.test.ts` — an off-corridor car is pulled back and damped, an
  on-road car is untouched, application is idempotent and safe on non-finite state.
- `tests/stage-surface-grip.test.ts` — every shipped zone's grip reaches the vehicle model.

## CPU opponents, difficulty tiers & fair catch-up (#APEX-7 / #APEX-8)

CPU drivers race the racing line headlessly and visibly (`?race=<stage>`). Four
difficulty tiers tune the field — each one changes the CPU's **corner speed**
(`skill`), **reaction** (`kHeading`/`kCross`) and **aggression** (`overtakeGain`,
following gap):

| Tier | `skill` | `reaction` | `aggression` | catch-up band |
| --- | --- | --- | --- | --- |
| `easy` | 0.80 | 0.90 | 0.70 | +4 % / −2 % |
| `normal` | 0.92 | 1.00 | 1.00 | +4 % / −2 % |
| `hard` | 1.02 | 1.04 | 1.10 | +3 % / −1.5 % |
| `rally-legend` | 1.06 | 1.08 | 1.15 | +3 % / −1.5 % |

**Catch-up is bounded and capped.** A CPU behind the reference gets at most the
tier's `maxBoost` target-speed multiplier; ahead it gets at most `maxSlow`; and the
effective skill is always clamped by the tier's `skillCap`. It only ever scales a
car's *target speed* — never a position or velocity — so it can never teleport a car.
A **solo reference "competent human"** pace car (skill 1.0, default tuning) grades the
balance: it wins on `easy` and can lose on `hard`/`rally-legend`.

The tiered field also runs the same soft roadside barrier as the visible race, so a
faster tier can never leave the ribbon, and the no-teleport / bounded-speed-delta
telemetry (`maxStepDisplacement`, `maxSpeedDelta`) is asserted on every stage.

```bash
bun run test                              # tests/difficulty.test.ts (AC1–AC7)
bun scripts/ai-difficulty-report.ts        # seeded win-rate + telemetry bands -> docs/evidence/
```

Open the visible race at a tier with `?race=alpine-forest&difficulty=hard` (unknown
values fall back to `normal`).

## Stage race loop

A stage is a countdown, a timed run through **ordered** checkpoints and a finish, giving a
result to compare against CPU opponents. `RaceController` owns every piece of race state;
the engine's fixed-timestep loop drives it through `update(dt)` and the world reports gate
crossings through `crossGate(id)`, so timing is deterministic and frame-rate independent.

```
stage_select --startStage--> countdown --countdownSeconds--> racing
racing --crossGate(all checkpoints + finish)--> finished
racing --missed > maxPenalties--> invalidated
finished|invalidated --restart--> countdown
finished|invalidated|racing|countdown --quit--> stage_select
```

### Module structure (`src/race/`)

| Module | Responsibility |
| --- | --- |
| `src/race/types.ts` | Domain types: `RacePhase`, `StageDefinition`, `CheckpointDef`, `Split`, `RaceResult`, `Standing`. |
| `src/race/stage.ts` | `defineStage` + `createDemoStage` — gate order, countdown, penalty rules and opponent times. |
| `src/race/race.ts` | `RaceController` — the `stage_select → countdown → racing → finished` state machine: timer, ordered checkpoints, penalties, splits. |
| `src/race/results.ts` | `sumSplits`, `rankStandings`, `formatTime` — split summation, position and time formatting. |
| `src/race/hud.ts` | `RaceHud` — DOM overlay for stage select, countdown, live timer and the results table. |
| `src/race/session.ts` | `StageSession` — binds one `RaceController` to the engine clock and gate events. |
| `src/race/index.ts` | `bootRace()` — composes session + HUD with keyboard gate crossings. |

### Rules

- **Countdown gates input.** `crossGate` is ignored unless `phase === "racing"`, and the
  timer starts at 0 the instant the countdown ends.
- **Checkpoints are ordered.** Crossing a later gate implies the ones in between were
  missed: each costs `penaltySeconds`; more than `maxPenalties` invalidates the run.
- **Finish stops the timer** and ranks the total against fixed opponent times for position.
- **`result.totalTime === sum(splits.delta) + penaltySeconds`** — the results table shows
  the per-gate split and cumulative time so the identity is visible.
- **Restart / quit reset every field**; no page reload is needed.

Since in-world gate detection is not part of this ticket (see `docs/openspecs/APEX-3.md`
non-goals), the HUD hosts a keyboard harness to simulate driving through gates: `1..9`
cross checkpoint N, `F` crosses the finish (both only while racing), `R` restarts and `Q`
quits to stage select.

### Verification

- `tests/race.test.ts` — one `describe` per acceptance criterion: countdown gating, ordered
  checkpoints, misses → penalty/invalidation, finish position/total, total = Σsplits, and
  restart/quit reset.
- `tests/results.test.ts` — split summation, ranking (incl. ties) and time formatting.
- `tests/session.test.ts` — engine `tick()` drives the race clock; restart/quit reset; the
  `onUpdate`/`onRender` hooks fire once per step/frame.
- `bun scripts/screenshot-race.mjs` — drives a full stage in headless Chromium and captures
  `docs/evidence/APEX-3-{stage-select,countdown,results,restart}.png`, asserting the
  countdown gates input, the skip adds a penalty, total = Σsplits + penalty, and restart /
  quit return to stage select.

