# APEX-28 — Terrain foundation: heightfield, biome surfaces and roadside containment

Epic: `2026-Q4-APEX-RALLY-APEX-02` — Stage Circuits & Nature Environments.
Binding architecture: `docs/architecture/2026-Q4-APEX-RALLY-APEX-02.md`.
Stacked on the merged stage/vehicle work: #APEX-4 (`StageCircuit` + six JSONs),
#APEX-2 (`Vehicle`, surface grip) and #APEX-3/#APEX-7 (race loop + visible CPU race).
Predecessor: **#APEX-5** was split and cancelled — this is the terrain slice.

## Problem

The six stage JSONs from #APEX-4 define a road ribbon floating in a void: there is
no ground around the corridor, no biome look, and nothing stops a car that runs
wide from drifting off the road into empty space. The nature epic cannot start
until the terrain base layer exists, and it must be data-driven so a seventh stage
is a JSON edit, not a code change.

## Goal

Render a **data-driven terrain heightfield per biome** (alpine-forest,
canyon-sprint, coastal-cliffs, desert-dunes, mountain-pass, valley-rally) with
biome-specific surface grip and a **containment boundary** that keeps the CPU and
player car on the road corridor. Terrain generation is deterministic per stage
seed, within the stage draw-call/triangle budget, and covered by unit tests.

## Non-goals

- **Foliage, dynamic sky and weather** — #APEX-29 (this ticket prints the
  `terrainLighting(timeOfDay)` seam, it does not implement sky/weather).
- **External meshes / textures** — #APEX-6. Terrain is procedural from the spline
  and the stage JSON; no new asset pipeline work.
- **Vehicle physics** — #APEX-2. Grip is still resolved through the existing
  `physicsSurfaceAt`; this ticket only adds a ground surface for the shoulder.
- **Authoring tooling / editor** — out of scope.

## Design

### Data

The optional `terrain` block extends the #APEX-4 stage format (still
`schemaVersion: 1`, unknown keys were already forward-compatible):

```jsonc
"terrain": {
  "seed": 1337,          // deterministic heightfield seed
  "relief": 8,           // vertical relief amplitude (m)
  "resolution": 15,      // lateral columns across the corridor
  "surface": "grass",    // ground surface outside the road (grip via zones)
  "corridorWidth": 34    // metres generated each side of the centreline
}
```

When omitted, `validateStage` defaults it deterministically from the stage **id**
(a stable string hash) and the biome, so every stage renders even without the
block. All six shipped JSONs carry an explicit seed.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/stage/terrain.ts` | `BIOME_TERRAIN` style table, deterministic value-noise fbm, `buildTerrain`, `terrainStats`, `checkTerrainBudget`, `TERRAIN_BUDGET`, `terrainLighting`, `timeOfDay`. |
| `src/stage/containment.ts` | `createContainment(circuit, spline)` → corridor projection + `resolve`/`apply` soft barrier. |
| `src/stage/types.ts` | `TerrainDef`, `TerrainStats`, `TerrainAppearance`, `ContainmentDef`; `StageCircuit.terrain`, `StageWorld.terrain`/`containment`. |
| `src/stage/schema.ts` | `terrain` object schema (all fields optional, ranges enforced). |
| `src/stage/validate.ts` | `RawStage.terrain`, normalise/default (seed from id hash). |
| `src/stage/world.ts` | Build terrain, add it to the group before the road, publish it on `StageWorld`, dispose it. |

### Heightfield

Terrain is a ribbon swept along the **same sampled spline** as the road: an
`along` grid (capped at 240 sections) × `resolution` lateral columns spanning
`[-corridorWidth, +corridorWidth]`.

- Inside the road half-width: `y = roadY − 0.04` (hidden under the ribbon).
- Outside it: a smooth bank rises to `ridgeHeight` at the corridor edge plus
  positive fbm relief, so the silhouette differs per biome.
- Vertex colour blends `ground → ridge` by height; material roughness comes from
  the style. Draw calls: **1** mesh.

Determinism: noise is an integer-lattice value-noise fbm seeded by
`terrain.seed`; positions are a pure function of `(circuit, spline)`.

### Containment

`createContainment` projects a `(x,z)` onto the centreline (nearest sample +
normal dot for sign) and clamps the lateral offset to
`road.width/2 + shoulder` (shoulder default 4 m). `apply(vehicle)` rewrites the
state back onto the boundary, zeroes `vLat` and scales `vLong`. A car already
inside the corridor is left untouched (idempotent).

## Acceptance criteria (Given/When/Then)

- **AC1 — distinct data-driven terrain per stage.** Given the six shipped stages,
  When each world builds, Then every stage has a terrain mesh with > 0 triangles,
  a distinct heightfield signature and a biome-specific colour; and `terrain.ts`
  contains no `switch`/`if` on `biome` (lookup table only).
- **AC2 — surface grip matches the stage surface.** Given a stage whose zone
  surface is snow/dirt/gravel/tarmac, When `physicsSurfaceAt` resolves it, Then
  the physics surface's lateral/longitudinal grip equals the zone grip.
- **AC3 — a car that leaves the corridor is contained.** Given a vehicle 30 m off
  the centreline, When containment applies, Then its lateral offset is ≤ the
  corridor half-width and its lateral velocity is 0; a car on the road is
  unchanged.
- **AC4 — deterministic per stage seed.** Given the same circuit, When terrain is
  built twice, Then the position buffers are identical; a different seed yields a
  different signature.
- **AC5 — budget at midday and dusk.** Given any shipped stage, When
  `checkTerrainBudget` runs for `"midday"` and `"dusk"`, Then triangles ≤
  `maxTriangles`, draw calls ≤ `maxDrawCalls`, and both reports are identical
  (geometry is time-invariant).

## How to test

- **Unit (Vitest, headless, real three.js):**
  - `tests/stage-terrain.test.ts` — AC1/AC4/AC5: all six stages build terrain,
    signatures differ, same-seed determinism, different-seed divergence, budget
    passes at midday/dusk, `terrainLighting` differs by time of day.
  - `tests/stage-containment.test.ts` — AC3: off-corridor car is pulled back and
    slowed, on-road car untouched, idempotent, finite-state safety.
  - `tests/surface-grip.test.ts` — AC2 (or extend the existing surface suite).
- **Existing gates:** `bun run typecheck`, `bun run test`, `bun run build` green.
- **Browser evidence:** `bun run build && bun scripts/screenshot-race.mjs` (or
  `screenshot-stage.mjs`) renders a terrain-dressed stage in headless Chromium
  (SwiftShader WebGL2).
- **Manual (how_to_test):** load `?race=<stage>`; confirm silhouette/surface match
  the stage; drive off the road and confirm containment; reload twice for the same
  terrain; check stats stay in budget.

## Evidence plan

- `docs/evidence/APEX-28-tests.txt`, `-typecheck.txt`, `-build.txt`,
  `-terrain.json` (per-stage stats), `-stage-*.png`.
- Board: openspec + architecture published; evidence note per gate.
