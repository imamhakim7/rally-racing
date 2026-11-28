# APEX-29 — Foliage, dynamic sky and weather layers on the terrain foundation

Epic: `2026-Q4-APEX-RALLY-APEX-02` — Stage Circuits & Nature Environments.
Binding architecture: `docs/architecture/2026-Q4-APEX-RALLY-APEX-02.md`.
Stacked on the merged layers: #APEX-4 (`StageCircuit` + six JSONs), #APEX-6
(glTF/KTX2 asset pipeline + budgets), #APEX-7 (visible CPU race) and **#APEX-28**
(terrain heightfield, biome surfaces, containment — `main f3d1ca1`).
Predecessor: **#APEX-5** was cancelled and split into #APEX-28 (terrain) and this,
the foliage/sky/weather slice.

## Problem

The terrain foundation gives every stage a ground silhouette and a biome palette,
but the world is still bare: no trees or scrub, a static midday sky, and a fixed
fog that never changes. The epic promises *themed nature biomes with dynamic sky
and weather, streamed within the frame budget*; without this layer the biomes read
as flat coloured ground and the visibility/grip behaviour a rally stage needs does
not exist.

#APEX-5 was unmergeable because it mixed foliage, sky/time-of-day and weather into
the terrain branch at once. This ticket keeps that split: each layer builds on the
now-stable terrain seam (`terrainLighting(timeOfDay)`, `terrain.sampleHeight`,
`terrain.seed`) and stays data-driven and deterministic.

## Goal

Add three layered, data-driven sub-systems on top of the terrain:

1. **Instanced biome foliage** — every biome scatters low-poly vegetation as a
   small number of `THREE.InstancedMesh` batches (never one draw call per tree),
   seeded deterministically per stage and pinned to the terrain surface.
2. **Configurable time-of-day sky** — sky colour, sun colour/intensity/direction
   and ambient light follow a configurable time of day; dusk is visibly different
   from midday.
3. **Weather presets** — `clear`, `rain`, `fog`, `dusk` change fog/visibility,
   dim the light, and reduce road grip (rain the most); switchable at runtime.

All three stay inside the documented per-stage draw-call/triangle budget and are
covered by headless unit tests, including the time-of-day and weather-to-grip
mapping.

## Non-goals

- **Terrain heightfield / containment** — #APEX-28 (consumed, not rebuilt).
- **External foliage meshes / textures** — #APEX-6 owns the asset pipeline; foliage
  uses procedural low-poly primitives so no new assets are needed.
- **A precipitation particle system / GPU weather** — out of scope; `rain` is a
  fog + light + grip preset (a visible weather *state*, not a particle sim).
- **A player-driven stage scene / full weather UI** — later integration (#APEX-2
  player scene, #APEX-11 menus). This ticket exposes a programmatic runtime API and
  URL parameters; it does not add a settings menu.

## Design

### Data

Two optional blocks extend the #APEX-4 stage format (still `schemaVersion: 1`;
unknown keys were already forward-compatible):

```jsonc
"foliage": {
  "seed": 1337,      // deterministic scatter seed (defaults to terrain.seed)
  "density": 1.0     // scatter density multiplier (0..2)
},
"weather": "clear"   // clear | rain | fog | dusk  (default "clear")
```

When omitted, `validateStage` defaults `foliage.seed` from the terrain seed and
`density` to `1`, and `weather` to `"clear"`, so every stage renders foliage and a
default sky with no file change.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/stage/foliage.ts` | `BIOME_FOLIAGE` style table, `FOLIAGE_GEOMETRY` kind table, deterministic scatter, `buildFoliage`, `foliageStats`, `checkFoliageBudget`, `FOLIAGE_BUDGET`. |
| `src/stage/weather.ts` | `WEATHER_PRESETS` table, `WeatherPreset`, `weatherGripMultiplier`, `applyWeatherToGrip`. |
| `src/stage/sky.ts` | `SKY_KEYFRAMES`, `timeOfDayFraction`, `skyState(timeOfDay, weather)`, `createSkyRig(scene)` — owns hemisphere/directional lights, `scene.background`/`scene.fog`; `setTimeOfDay`/`setWeather` runtime toggles. |
| `src/stage/terrain.ts` | `terrainLighting(timeOfDay)` now derives from `skyState` so the terrain seam and the sky agree (kept exported/back-compatible). |
| `src/stage/types.ts` | `FoliageKind`, `FoliageSpecies`, `FoliageStyle`, `FoliageDef`, `FoliageStats`, `FoliageBuild`, `WeatherPreset`; `StageCircuit.foliage`/`.weather`, `StageWorld.foliage`. |
| `src/stage/schema.ts` | `foliage` object + `weather` enum schemas (all optional, ranges enforced). |
| `src/stage/validate.ts` | `RawStage.foliage`/`.weather`, normalise/default. |
| `src/stage/world.ts` | Build foliage, add it to the group after the road, publish it on `StageWorld`, dispose it. |
| `src/ai/surface.ts` | `physicsSurfaceAt(circuit, t, weather?)` multiplies the zone grip by the weather grip (default `clear` = unchanged). |
| `src/stage/scene.ts`, `src/scenes/aiRaceScene.ts` | Create a `SkyRig`, apply time-of-day/weather, expose runtime setters; race scene resolves grip with the active weather. |
| `src/main.ts` | `?time=`/`?weather=` URL params configure the rig at boot; expose it on `window.apexRace`. |

### Foliage

Foliage is a ribbon scatter over the **same sampled spline** as the road/terrain.
For each section along the spline and each side, the builder walks lateral offsets
from just outside the road edge to the corridor edge and places an instance when a
seeded hash passes the species density test.

- **Table, not branches.** `BIOME_FOLIAGE: Record<Biome, FoliageStyle>` selects 1–2
  species per biome; each species carries a `kind` (`"conifer" | "broadleaf" |
  "shrub" | "rock"`) resolved through `FOLIAGE_GEOMETRY: Record<FoliageKind, …>`.
  The builder never `switch`es on `biome`.
- **Instancing.** One `THREE.InstancedMesh` per species → draw calls equal the
  species count (≤ 2–3 per stage), independent of tree count. No per-tree draws.
- **Determinism.** Placement uses the #APEX-28 integer-lattice hash seeded by
  `foliage.seed`; no `Math.random`, no clock. Same circuit ⇒ identical matrices.
- **Grounded.** Each instance's `y` is `terrain.sampleHeight(t, lateral)`, so trees
  sit on the hillside and never float or poke through the road.

### Sky & time of day

A small keyframe curve over a **day fraction** `[0,1)` defines sun/ambient colour,
intensity, direction, sky background and the base fog. Named times map to fractions
(`dawn 0.15`, `midday 0.5`, `dusk 0.85`, `night 0.95`). `skyState(timeOfDay, weather)`
interpolates the keyframes, applies the weather tint/dim, then returns the concrete
lighting + fog the `SkyRig` writes into the scene. `terrainLighting` delegates to
this so the terrain seam and the sky can never disagree. Dusk has a darker, warmer
sky/sun than midday (asserted in tests).

### Weather & grip

`WEATHER_PRESETS` is a lookup table; each preset carries `fogNear/fogFar/fogColor`,
`skyTint`, `sunScale`, `ambientScale`, a `gripMultiplier` and whether it forces a
time of day (`dusk` → dusk). Rain is the strongest grip penalty; fog cuts
visibility; clear is the reference. `physicsSurfaceAt(circuit, t, weather)` scales
the authored zone grip by `weatherGripMultiplier(weather)`, so the same road grips
less in the wet — the mapping unit-tested by AC5.

## Acceptance criteria (Given/When/Then)

- **AC1 — four biomes render instanced foliage, no per-tree draw calls, deterministic.**
  Given the six shipped stages, When each world builds, Then every stage has a
  foliage group of `InstancedMesh` batches whose **draw calls equal the species
  count** (≪ instance count) and ≥ 4 distinct biomes have instances; the same
  circuit rebuilt yields byte-identical instance matrices, a different seed
  diverges; and `foliage.ts` contains no `switch`/`if` on `biome` (table only).
- **AC2 — sky/sun/ambient follow a configurable time of day; dusk ≠ midday.**
  Given the `SkyRig` on a scene, When `setTimeOfDay("dusk")` then
  `setTimeOfDay("midday")`, Then `scene.background`, the sun colour/intensity and
  the ambient light change, and the dusk reads are all distinct from midday; a
  numeric day-fraction is accepted too.
- **AC3 — weather changes fog/visibility + grip and toggles at runtime.**
  Given the `SkyRig`, When `setWeather("fog")` / `setWeather("rain")`, Then
  `scene.fog.near/far` and `scene.background` change, `weatherGripMultiplier("rain")
  < 1` and `physicsSurfaceAt(…, "rain")` grip < the same surface in `"clear"`; the
  preset is switchable after construction and the value is observable.
- **AC4 — foliage and weather stay within the documented budget.**
  Given any shipped stage, When `checkFoliageBudget` and the combined nature budget
  run at `"midday"` and `"dusk"`, Then triangles ≤ `maxTriangles`, draw calls ≤
  `maxDrawCalls`, weather adds 0 draw calls/triangles, and both times agree.
- **AC5 — unit tests cover the time-of-day and weather-to-grip mapping.**
  Given the pure functions, Then `skyState` differs by time of day and
  `weatherGripMultiplier`/`applyWeatherToGrip` are covered (`clear` = 1, `rain` <
  `fog` ≤ 1), and the shipped stages all pass AC1–AC4.

## How to test

- **Unit (Vitest, headless, real three.js):**
  - `tests/stage-foliage.test.ts` — AC1/AC4: all six stages build foliage, no
    per-tree draws, ≥ 4 biomes populated, same-seed determinism, different-seed
    divergence, budget pass at midday/dusk.
  - `tests/stage-sky-weather.test.ts` — AC2/AC3/AC5: `skyState` midday vs dusk,
    numeric day-fraction, weather fog/background change, grip mapping (`clear` = 1,
    `rain` < `fog`), `SkyRig` runtime toggles, `physicsSurfaceAt` weather parity,
    combined budget.
  - `tests/stage-surface-grip.test.ts` — unchanged (default weather keeps zone grip).
- **Existing gates:** `bun run typecheck`, `bun run test`, `bun run build` green.
- **Browser evidence:** `bun run build && bun scripts/screenshot-nature.mjs` loads a
  stage through `?race=` and captures midday/dusk/rain/fog from headless Chromium
  (SwiftShader WebGL2) plus per-stage foliage/weather stats → `APEX-29-*.png`,
  `APEX-29-nature.json`.
- **Manual (how_to_test):** load `?race=<stage>`, append `&time=dusk&weather=rain`,
  confirm the sky darkens and grip drops; call
  `window.apexRace.scene.setWeather("fog")` at runtime; check the stats overlay
  stays within budget.

## Evidence plan

- `docs/evidence/APEX-29-tests.txt`, `-typecheck.txt`, `-build.txt`,
  `-nature.json` (per-stage foliage/weather stats), `-midday.png`, `-dusk.png`,
  `-rain.png`, `-fog.png`.
- Board: openspec + architecture published; evidence note per gate.
