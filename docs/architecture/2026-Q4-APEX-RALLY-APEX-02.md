# Epic architecture — `2026-Q4-APEX-RALLY-APEX-02` Stage Circuits & Nature Environments

Binding design for every ticket under this epic. If a ticket needs to diverge, it
updates this document first, then the code (SDD rule: **spec → change → test →
validate**). The stage JSON format itself is owned by #APEX-4
(`docs/openspecs/APEX-4.md`); this document records how the *nature* layers stack
on top of it.

## Why

The brief asks for many stage circuits and a nature background, but no circuit
format, biome art or asset pipeline exists. The epic delivers **six or more
data-driven stage circuits across themed nature biomes**, with dynamic sky and
weather, streamed within the frame budget.

## Goal

Six+ circuits load from data and are dressed with a nature environment — terrain,
biome surface materials, foliage, sky and weather — that stays inside the frame
budget and never lets the car leave the road corridor.

## Principles

1. **Data over branches.** A stage's nature is described by its JSON (`biome` +
   an optional `terrain` block) plus a small style table. Adding a stage or a
   biome is a content edit, never a new `if (biome === …)` branch in the builder.
2. **The centreline is the spine.** Terrain, road, gates, minimap and containment
   are all derived from the same sampled spline, so they cannot disagree.
3. **Deterministic by seed.** Heightfields, foliage scatter and weather are pure
   functions of `(seed, biome, spline)` — no `Math.random`, no wall clock — so a
   stage reproduces exactly and the whole thing is unit-testable headlessly.
4. **Budgeted.** Every layer publishes its draw-call/triangle cost and is checked
   against the per-stage budget at **midday and dusk** before it ships.
5. **Contained.** The corridor is a soft barrier: a car that runs wide is pushed
   back and slowed (or respawned) rather than falling through or driving on air.
6. **Layered, not merged.** Terrain ships first (#APEX-28); foliage, sky and
   weather (#APEX-29) read the terrain's surface/lighting seam.

## System shape

```
stage JSON ──#APEX-4──▶ StageCircuit
                              │
        ┌─────────────────────┼───────────────────────────┐
        ▼                     ▼                           ▼
  src/stage/terrain.ts   src/stage/containment.ts   src/stage/world.ts
  heightfield + biome    corridor projection +      assembles group:
  material + budget      soft barrier / respawn     road + gates + terrain
        │                     │                           │
        └────────────► #APEX-7 visible race scene ◄──────┘
                       (ground the car, contain it)
```

## Interfaces owned by this epic

```ts
// #APEX-4 (format) — this epic consumes it.
interface StageCircuit { biome: Biome; terrain: TerrainDef; /* … */ }

// #APEX-28 — terrain foundation
interface TerrainDef { seed: number; relief: number; resolution: number;
                       surface: SurfaceType; corridorWidth: number }
interface TerrainBuild { mesh: THREE.Mesh; stats: TerrainStats; style: BiomeTerrainStyle }
function buildTerrain(circuit: StageCircuit, spline: SampledSpline): TerrainBuild
function checkTerrainBudget(circuit: StageCircuit, timeOfDay?: TimeOfDay): BudgetReport

// #APEX-28 — containment
interface Containment { halfWidth: number; resolve(x,z,yaw): ContainmentResult;
                        apply(vehicle: Vehicle): ContainmentResult }
function createContainment(circuit: StageCircuit, spline: SampledSpline): Containment

// #APEX-28 — printed seam, consumed by #APEX-29
interface TerrainLighting { sunColor: number; sunIntensity: number; … }
function terrainLighting(timeOfDay: TimeOfDay): TerrainLighting

// #APEX-29 — foliage / sky / weather layers (implemented here)
interface FoliageDef { seed: number; density: number }
interface FoliageBuild { group: THREE.Group; stats: FoliageStats }
function buildFoliage(circuit, spline, terrain): FoliageBuild
function checkFoliageBudget(circuit, spline, timeOfDay?): FoliageBudgetReport

type WeatherPreset = "clear" | "rain" | "fog" | "dusk"
function weatherGripMultiplier(preset: WeatherPreset): number  // clear = 1, rain < 1
function physicsSurfaceAt(circuit, t, weather?: WeatherPreset): PhysicsSurface

interface SkyRig {
  setTimeOfDay(t: TimeOfDay | number): void   // named or day fraction [0,1)
  setWeather(preset: WeatherPreset): void
  readonly timeOfDay: TimeOfDay
  readonly weather: WeatherPreset
  dispose(): void
}
function createSkyRig(scene: THREE.Scene, opts?): SkyRig
function skyState(timeOfDay: TimeOfDay | number, weather: WeatherPreset): SkyState
```

## Invariants

1. **No per-biome branches.** `BIOME_TERRAIN: Record<Biome, …>` is a lookup
   table; the builder never `switch`es on `biome`.
2. **Terrain never rises through the road.** Inside the road half-width the
   heightfield sits a constant epsilon *below* the road ribbon; outside it banks
   up to the corridor edge.
3. **Determinism.** `buildTerrain` for the same circuit yields byte-identical
   positions; a different `terrain.seed` yields a different heightfield.
4. **Budget.** `checkTerrainBudget` reports triangles/draw calls and fails when
   either exceeds `TERRAIN_BUDGET`; geometry is time-of-day invariant so the
   budget holds at midday and dusk (lighting is layered by #APEX-29).
5. **Containment is idempotent and safe.** A car already inside the corridor is
   untouched; a car outside is projected back onto the boundary, its lateral
   velocity zeroed and speed penalised. `apply` never throws on a finite state.
6. **Lifecycle.** Terrain geometry/materials are disposed exactly once by
   `disposeStageWorld`, like every other mesh in the world.
7. **Foliage is instanced and baked.** `BIOME_FOLIAGE` + `FOLIAGE_GEOMETRY` are
   lookup tables (never `switch` on `biome`); a stage's vegetation is a handful of
   `InstancedMesh` batches, so draw calls scale with *species*, not tree count.
   Scatter is a pure function of `(foliage.seed, spline, terrain)` and each
   instance sits on `terrain.sampleHeight`.
8. **Sky and weather are one seam.** `terrainLighting` and `createSkyRig` both read
   `skyState(timeOfDay, weather)`; time-of-day and weather can be toggled at runtime
   and weather scales the authored zone grip through `physicsSurfaceAt`. Weather
   adds no geometry, so it cannot blow the draw-call/triangle budget.

## Epic acceptance (inherited by tickets)

- Six+ circuits render distinct, data-driven nature (terrain silhouette +
  surface material + biome) with no per-biome code branch.
- Surface grip matches the stage surface through the existing vehicle model.
- A car that leaves the corridor is contained instead of falling through or
  driving on air.
- Nature generation is deterministic per stage seed and unit-tested.
- Draw calls/triangles stay within the stage budget at midday and dusk.

## Ticket map

| Ticket | Contributes |
| --- | --- |
| #APEX-4 | Data-driven stage circuit format, loader, six stage JSONs (deployed) |
| #APEX-6 | glTF/KTX2 asset pipeline with load budgets (deployed) |
| #APEX-28 | Terrain foundation: heightfield, biome surfaces, containment (deployed) |
| **#APEX-29** | **Foliage, dynamic sky and weather layers on the terrain foundation** |
| #APEX-5 | *(cancelled)* superseded by the #APEX-28/#APEX-29 split |
