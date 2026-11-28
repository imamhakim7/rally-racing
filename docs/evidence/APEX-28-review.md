# APEX-28 — code review

Verdict: **approve**. Reviewer read the committed diff (`d9685a7`) against
`docs/openspecs/APEX-28.md` and the epic architecture.

## What was checked

- **Spec/architecture binding.** The openspec and
  `docs/architecture/2026-Q4-APEX-RALLY-APEX-02.md` were written before the code
  (SDD) and match the implementation: `TerrainDef`/`TerrainBuild`/`Containment`
  interfaces are as specified.
- **No per-biome code branch (AC1).** `rg 'biome ===|switch \(.*biome\)|case "forest"' src/stage/terrain.ts`
  returns nothing; `BIOME_TERRAIN` is a `Record<Biome, …>` lookup and the builder
  reads `BIOME_TERRAIN[circuit.biome]`.
- **Validation fails closed.** `schema.ts` adds the `terrain` object with ranges
  (`resolution` 5..32, `relief` 0..60, `corridorWidth` 4..400, integer `seed`);
  `validate.ts` defaults every omitted field deterministically from the id. A bad
  stage never reaches `buildTerrain` (#APEX-4 invariant 2 preserved).
- **Lifecycle.** `buildTerrain` returns one mesh; `disposeStageWorld` already
  traverses the group and disposes it exactly once (existing `stage-world.test.ts`
  disposal test still passes).
- **Determinism.** No `Math.random`/clock in `terrain.ts`/`containment.ts`.
- **Containment safety.** `resolve` is idempotent (a corrected point reports
  `contained: false`) and `apply` never throws on a non-finite state.

## Findings

- **R1 (found & fixed during the change).** The first containment integration
  clamped *finished* cars (parked off the line by `parkOffLineCar`) onto the same
  boundary point, collapsing `minSeparation` to 0 in
  `tests/aiRaceScene.test.ts`. Fixed by exempting finished cars from containment
  in `aiRaceScene.ts`; the full suite is green.
- **R2 (minor, addressed).** An unbounded `resolution` could exceed
  `TERRAIN_BUDGET`; the schema now caps `resolution` at 32 so the worst-case
  ribbon (240 × 32) stays inside 16k triangles. `checkTerrainBudget` still
  asserts it at runtime.
- **R3 (n/a).** No public API change to existing modules; only additive fields on
  `StageCircuit`/`StageWorld` and a new optional JSON block.

## Evidence

- `docs/evidence/APEX-28-tests.txt` — 242 tests pass.
- `docs/evidence/APEX-28-changed-tests.txt` — 21 changed-path tests pass.
- `docs/evidence/APEX-28-typecheck.txt`, `APEX-28-build.txt` — clean.
