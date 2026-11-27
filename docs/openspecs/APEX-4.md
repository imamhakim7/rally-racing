# APEX-4 — Data-driven Stage Circuit Format & Loader

Epic: `2026-Q4-APEX-RALLY-APEX-02` — Stage Circuits & Nature Environments.

Stacked on: **#APEX-1** (three.js engine bootstrap, `chore/APEX-1-…`, PR #1).
Consumes at runtime: **#APEX-3** (`StageDefinition` — the race loop reads the gates this
ticket emits). Related: **#APEX-5** (terrain/biomes build on the surface zones + spline).

## Problem

The brief calls for **many** stage circuits, but every track is currently hard-coded in
TypeScript. Adding a stage is a programming task: edit geometry code, recompile, retest.
That blocks the content author, makes each new circuit a bug-surface and gives the race
loop (#APEX-3) nothing to read. There is no format, no loader, no validation and no way to
resolve a stage's road, gates, surfaces or minimap from data.

## Goal

A single JSON document describes a rally stage — **centreline spline, road surface,
checkpoint gates, surface zones, start/finish and minimap path** — and a loader builds it
into the three.js world with **no code change**. A schema validator rejects a malformed
stage with a **clear error that names the offending field**. At least **six** stages ship
and load in one build, and a stage select switches between them live.

## Non-goals

- **Terrain, biomes, foliage, sky and weather** — #APEX-5. This ticket records a `biome`
  label and surface zones as data; it renders no nature art.
- **Race timing / checkpoint ordering / penalties** — #APEX-3. We emit gate definitions;
  #APEX-3 owns crossing logic.
- **Vehicle physics and grip resolution** — #APEX-2 consumes `surface.grip`; we only
  publish it.
- **Asset formats (glTF/KTX2)** — #APEX-6. Road/gate/zone geometry is generated
  procedurally from the spline; no external meshes.
- **Menus / full stage-select UX** — #APEX-11. We provide a minimal, testable selector and
  the data the full menu will use.

## Architecture (epic binding)

The epic architecture binds "a JSON stage format (centreline spline, checkpoint gates,
surface zones, minimap path) **built into road meshes at load**". This ticket implements
exactly that as a **pure, headless-testable** pipeline plus a thin `SceneHandle` adapter
and a DOM stage select. The loader is the single source of truth: the race loop (#APEX-3),
the HUD/minimap (#APEX-10), the biomes (#APEX-5) and pace notes (#APEX-18) all read the
same resolved `StageCircuit`.

```
JSON ──parse──▶ validate(schema) ──▶ StageCircuit ──build──▶ StageWorld (THREE.Group)
                                          │                      ├─ road ribbon mesh (spline)
                                          │                      ├─ checkpoint gate meshes
                                          │                      ├─ surface zone meshes
                                          │                      ├─ start/finish gantry
                                          │                      └─ minimap path (2D)
                                          └─▶ toRaceStage() ──▶ #APEX-3 StageDefinition
```

### Modules

| Module | Responsibility |
| --- | --- |
| `src/stage/types.ts` | Domain types: `StageCircuit`, `SplineDef`, `CheckpointSpec`, `SurfaceSpec`, `StartSpec`, `FinishSpec`, `MinimapSpec`, `ResolvedGate`, `ResolvedSurfaceSpan`, `StageWorld`. |
| `src/stage/schema.ts` | The declarative schema descriptor (`StageSchema`) — every field, type, range and required-ness in one place. |
| `src/stage/errors.ts` | `StageValidationError` (`{ path, code, value }`) and `formatStageError`. |
| `src/stage/validate.ts` | Generic walker: validate any object against `StageSchema`; collect **all** issues with dotted field paths; semantic checks (unique ids, gate `t` ordering, surface coverage, spline length). |
| `src/stage/spline.ts` | Catmull-Rom centreline: `sampleSpline` by arc length, tangents/normals, `detectCorners`, minimap projection; deterministic (no random). |
| `src/stage/road.ts` | `buildRoadGeometry(spline, road, spans)` → `THREE.BufferGeometry` ribbon (positions/normals/uvs/indices/colour) + `resolveSurfaceSpans`/`surfaceAt`. |
| `src/stage/minimap.ts` | `resolveMinimapPath(circuit, spline)` → normalised 2-D points + SVG `d` string for the HUD minimap. |
| `src/stage/world.ts` | `buildStageWorld(circuit)` → `StageWorld` (`group`, anchors, gate transforms, zone spans, bounds); `disposeStageWorld`. |
| `src/stage/loader.ts` | `loadStage(json, source)` → `StageCircuit`; `parseStage(text, source)` (JSON.parse + validate). |
| `src/stage/library.ts` | `StageLibrary`: reads the generated `data/index.ts` listing every stage JSON (add a file + `gen:stages` = **no code change**), caches, lists the catalog and loads by id. |
| `src/stage/scene.ts` | `createStageScene(library)` → `SceneHandle & { load(id), current, world }`, swapping the built world inside one `THREE.Scene`. |
| `src/stage/select.ts` | `mountStageSelect(host, library, handle)` → `<select>` overlay that swaps stages live (keyboard accessible). |
| `src/stage/race-adapter.ts` | `toRaceStage(circuit)` → the `{ id, name, checkpoints[], finishId, … }` shape #APEX-3 consumes. |
| `src/stage/data/*.json` | Six shipped circuits across six biomes. |
| `src/stage/data/index.ts` | Generated static import list (committed; `scripts/generate-stage-index.ts` regenerates it). |
| `src/stage/index.ts` | Barrel. |

### The stage JSON format (v1)

```jsonc
{
  "schemaVersion": 1,
  "id": "alpine-forest",            // slug, unique
  "name": "Alpine Forest",          // display name
  "biome": "alpine",                // forest|alpine|coastal|valley|canyon|desert|…
  "difficulty": 3,                  // 1..5
  "start":    { "position": [x, y, z], "headingDeg": 0 },
  "finish":   { "t": 1.0, "gate": { "width": 12, "height": 6 } },   // t optional (default 1)
  "spline": {
    "closed": false,
    "tension": 0.5,                 // Catmull-Rom alpha/tension 0..1
    "points": [ { "x": 0, "y": 0, "z": 0 }, … ]   // >= 2
  },
  "road": { "width": 9, "sampleStep": 2, "surface": "gravel", "bankingDeg": 0 },
  "checkpoints": [
    { "id": "cp-1", "name": "Crest", "t": 0.22, "width": 10, "height": 6 }
  ],
  "surfaces": [
    { "id": "sz-start", "surface": "tarmac", "from": 0.0,  "to": 0.15, "grip": 1.00 },
    { "id": "sz-woods", "surface": "gravel",  "from": 0.15, "to": 0.70, "grip": 0.72 },
    { "id": "sz-ford",  "surface": "water",   "from": 0.70, "to": 0.75, "grip": 0.40, "depth": 0.35 },
    { "id": "sz-crest", "surface": "gravel",  "from": 0.75, "to": 1.00, "grip": 0.72 }
  ],
  "minimap": { "color": "#e8c547", "path": "auto" }   // "auto" = project the spline
}
```

- **Centreline spline** is the source of truth: the road mesh, the finish anchor, the
  minimap path and every checkpoint/gate transform are derived from it.
- **Checkpoints** are placed by arc-length fraction `t ∈ [0,1]`, so a stage can be edited
  without touching vertex coordinates. `finish` behaves like a checkpoint at `t = 1`.
- **Surface zones** are half-open `[from, to)` spans over the same arc-length axis; they
  must tile `[0,1]` with no gaps or overlaps (a clear validator error if they do not).
- **Minimap path** defaults to `"auto"` (the projected spline); explicit `points` override.

### Interfaces

```ts
interface StageValidationError extends Error {
  readonly path: string;   // e.g. "checkpoints[2].width"
  readonly code: string;   // e.g. "range" | "type" | "required" | "unique" | "coverage"
  readonly value: unknown;
}

function loadStage(json: unknown, source?: string): StageCircuit;
function parseStage(text: string, source?: string): StageCircuit; // JSON.parse + loadStage
// throws StageValidationError with ALL issues; .message names every path

class StageLibrary {
  list(): StageCatalogEntry[];                 // id, name, biome, difficulty
  has(id: string): boolean;
  load(id: string): StageCircuit;              // throws "unknown stage: <id>"
  get size(): number;                          // >= 6 in one build
}

function buildStageWorld(circuit: StageCircuit): StageWorld;
function createStageScene(library: StageLibrary): StageSceneHandle; // implements SceneHandle + load()
function toRaceStage(circuit: StageCircuit): RaceStageShape;        // #APEX-3 contract
```

### Invariants

1. **No code change to add a stage.** `StageLibrary` reads the generated static index
   `src/stage/data/index.ts` (produced by `bun run gen:stages`, wired to run before
   `dev`/`build`); dropping in a valid file adds a stage and nothing else changes. A static
   index — not Vite's `import.meta.glob` — keeps the library resolvable in the browser
   bundle, the dev server and plain `bun`/`node` test runners alike.
2. **Validation fails closed and loud.** A malformed stage never reaches the world builder;
   `StageValidationError.message` contains the dotted `path` of every problem.
3. **One source of truth.** Road mesh, gate transforms, surface spans and minimap all come
   from the *same* sampled spline — they cannot disagree with the file.
4. **Determinism.** Sampling depends only on the file; no randomness, no wall clock.
5. **Lifecycle.** `disposeStageWorld` / scene disposal frees every geometry/material it
   created, exactly once; swapping stages disposes the previous world.
6. **Bounds.** `StageWorld.bounds` encloses the road + gates (used for culling/#APEX-13).
7. **Arc-length parity.** `t` is arc-length parameterised, not u-parameterised, so equal
   `t` gaps are equal distances along the road.

### Edge cases

- Spline with exactly 2 points → a straight road (valid); 1 point → `required` error.
- Duplicate checkpoint / surface ids → `unique` error naming the id.
- Checkpoint `t` outside `[0,1]` or non-finite → `range` error.
- Surface zones with a gap (`to` of one ≠ `from` of the next) or overlap → `coverage`
  error naming both zone ids.
- `schemaVersion` that is missing or not `1` → error naming `schemaVersion`.
- Road width ≤ 0, `sampleStep` ≤ 0, gate width/height ≤ 0 → `range` error.
- Extra/unknown keys are **ignored** (forward-compatible), but a *known* key with the
  wrong type is an error.
- A JSON file that is not an object, or invalid JSON syntax → `parse` error with the
  source name.

## Acceptance criteria (Given/When/Then)

- **AC1 — a stage JSON loads with no code change.** Given a new valid `data/<id>.json`,
  When the app builds, Then `StageLibrary` lists it and `load(id)` returns the circuit with
  no TypeScript edit.
- **AC2 — the road mesh is generated from the spline.** Given a circuit, When
  `buildStageWorld`, Then the road mesh's vertex count is `2 × samples`, its width matches
  `road.width`, and its positions lie on the sampled spline offsets.
- **AC3 — checkpoints resolve from the file.** Given `checkpoints[]` with ids/`t`, When the
  world builds, Then there is exactly one gate per checkpoint (plus the finish), in file
  order, each anchored on the spline at its `t`.
- **AC4 — surface zones resolve from the file.** Given `surfaces[]`, When the world builds,
  Then every zone maps to a contiguous span of the road and the ordered spans tile `[0,1]`;
  grip values match the file.
- **AC5 — the minimap path resolves from the file.** Given `minimap.path`, When built, Then
  the path is the projected centreline (auto) or the explicit points, within unit bounds
  for `auto`.
- **AC6 — six stages load in one build.** Given the shipped data, Then `library.size >= 6`,
  every stage loads and builds without error, and each has a distinct id/biome.
- **AC7 — the validator rejects a malformed stage and names the field.** Given a corrupt
  field (e.g. `checkpoints[1].width = "wide"`), When `loadStage`, Then it throws
  `StageValidationError` whose `path === "checkpoints[1].width"` (among others) and whose
  message includes that path; the world builder is never reached.
- **AC8 — stage select swaps stages live.** Given the mounted selector, When a different
  stage is chosen, Then the scene's world swaps to that circuit, the previous world is
  disposed, and `current.id` updates — no page reload. (#APEX-3's loop reads the new gates.)

## How to test

- **Unit (Vitest, headless, plain objects + real three.js):**
  - `tests/stage-validate.test.ts` — AC1/AC7: valid stage passes; each corruption yields
    the exact `path` (type, required, range, unique, coverage, schemaVersion, parse).
  - `tests/stage-spline.test.ts` — arc-length sampling, monotonic `t`, road vertex/width
    parity (AC2), corner detection.
  - `tests/stage-world.test.ts` — AC2–AC5: road mesh from spline, one gate per checkpoint +
    finish in order, surface spans tile `[0,1]`, minimap path, bounds, dispose.
  - `tests/stage-loader.test.ts` — AC1/AC6: all six shipped stages load, catalog ≥ 6,
    unknown id throws, `toRaceStage` emits #APEX-3's checkpoint shape.
  - `tests/stage-scene.test.ts` — AC8: `createStageScene` implements `SceneHandle`, `load`
    swaps + disposes, `resize`/`interpolate`/`dispose` are safe.
  - `tests/stage-data-integrity.test.ts` — the generated `data/index.ts` lists exactly the
    JSON files on disk (guards against drift).
- **Browser evidence:** `bun run build && bun scripts/screenshot-stage.mjs` renders stage
  select → a loaded stage (road + gates + surfaces) → a second stage in headless Chromium
  (SwiftShader WebGL2), writing `docs/evidence/APEX-4-*.png`.
- **Manual (how_to_test):** run `bun run dev`, use the stage-select overlay; then corrupt
  one field in a `data/*.json` and confirm the validator names it in the console.
- **Gates:** `bun run typecheck`, `bun run test` and `bun run build` must be green, and the
  platform's changed-test gate (`bun test <changed>` after `SARAWEDI_TEST_CMD=bun test`)
  must pass; evidence attached to the ticket.

## Evidence plan

- `bun run test` output (new + existing suites), `tsc --noEmit` clean, `vite build` success
  → `docs/evidence/APEX-4-*.txt`.
- `docs/evidence/APEX-4-stage-*.png` — two different stages rendered with the road mesh,
  checkpoint gantries and surface zones visible.
- Board: openspec published, evidence attachments + a note summarising the AC coverage.
