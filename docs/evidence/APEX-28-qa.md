# APEX-28 — QA verification

Verdict: **pass**. Every acceptance criterion is mapped to an automated check and,
where player-facing, to headless-browser evidence.

## Acceptance → evidence

| AC | Check | Result |
| --- | --- | --- |
| **AC1** data-driven, distinct terrain; no per-biome branch | `tests/stage-terrain.test.ts` builds all 6 stages, asserts 6 distinct heightfield signatures, 6 distinct biome palettes and a `vertexColors` material; `rg` finds no `biome` branch | pass |
| **AC2** surface grip matches the stage surface | `tests/stage-surface-grip.test.ts` — every shipped zone resolves to its authored grip + physics class (`tarmac/gravel/snow/dirt` all present) | pass |
| **AC3** off-corridor car is contained | `tests/stage-containment.test.ts` (pull-back, damping, idempotent, NaN-safe) + `docs/evidence/APEX-28-terrain.json` (`containment.contained: true`, `onRoad: true` for all 6 stages) | pass |
| **AC4** deterministic per stage seed | `tests/stage-terrain.test.ts` (identical buffers, different seed diverges) + browser reload of `alpine-forest` → identical signature `3794430139` | pass |
| **AC5** budget at midday and dusk | `tests/stage-terrain.test.ts` (budget ok, identical stats both times) + browser per-stage stats (max 6664 triangles, 1 draw call ≤ `TERRAIN_BUDGET`) | pass |

## Browser run (headless Chromium / SwiftShader WebGL2)

`bun scripts/screenshot-terrain.mjs` → `docs/evidence/APEX-28-terrain.json` (`ok: true`,
`problems: []`):

| Stage | Triangles | Draw calls | Surface | On road | Contained |
| --- | ---: | ---: | --- | --- | --- |
| alpine-forest | 6664 | 1 | grass | yes | yes |
| canyon-sprint | 4368 | 1 | dirt | yes | yes |
| coastal-cliffs | 6076 | 1 | sand | yes | yes |
| desert-dunes | 3976 | 1 | sand | yes | yes |
| mountain-pass | 5684 | 1 | snow | yes | yes |
| valley-rally | 3528 | 1 | grass | yes | yes |

Screenshots: `APEX-28-terrain-alpine-forest.png`, `APEX-28-terrain-desert-dunes.png`.

## Regression

- Full suite: **242 passed** (`APEX-28-tests.txt`); changed-path suite 21 passed
  (`APEX-28-changed-tests.txt`).
- `tsc --noEmit` clean (`APEX-28-typecheck.txt`); `vite build` succeeds
  (`APEX-28-build.txt`).
- `tests/aiRaceScene.test.ts` still proves a full race with every car on the road
  and no overlap (min separation > 2 m) after containment was wired in.

## Residual risk

- The `?race=` scene is CPU-only; containment is proven for the CPU field and for a
  real `Vehicle` in unit tests. A dedicated player-driven stage scene is not in this
  ticket's scope (the player vehicle still uses the lane test scene, #APEX-2).
