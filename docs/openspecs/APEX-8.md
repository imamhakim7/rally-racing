# APEX-8 — Difficulty Tiers and Fair Catch-Up Tuning

Epic: `2026-Q4-APEX-RALLY-APEX-03` — CPU Opponents & Racing Balance.
Consumes: **#APEX-7** (`CpuDriver`, `simulateRace`, `DriverTuning`, `CpuCarSpec`,
`RaceResult`) and the bounded-`skill` seam #APEX-7 deliberately exposed.
Unblocks: **#APEX-9** (headless harness reads the tiered `RaceResult` telemetry).
Binding design: `docs/architecture/2026-Q4-APEX-RALLY-APEX-03.md`.

## Problem

Opponents must be beatable but not trivial, yet #APEX-7 ships a single, untuned
field: every CPU uses near-identical `skill` and there is no difficulty setting, so
the race is equally hard (or easy) for everyone. Naïve "rubber-banding" is worse than
none — an unbounded speed boost feels like cheating and a position/velocity nudge
teleports a car, both of which destroy the rally feel.

## Goal

Four difficulty tiers (`easy`, `normal`, `hard`, `rally-legend`) each tune the CPU's
**corner speed**, **reaction** and **aggression**, and add a **bounded, capped**
catch-up that only ever scales a car's *target speed* — never its position. A
competent reference human wins on `easy` and can lose on `hard`/`rally-legend`, and
telemetry proves the speed delta between the player and the pack stays bounded.

## Non-goals

- **Ghost replays / replay serialisation** — #APEX-9.
- **An in-world human-vs-CPU race session / results wiring** — a later integration
  ticket. This ticket models the "competent human" as a deterministic reference
  *pace car*, purely to grade tier balance headlessly.
- **Vehicle-car collision response / damage** — none exists (#APEX-2); catch-up and
  difficulty only shape commands.
- **Difficulty selection UI** — the tier is a parameter/URL query here; the menu
  surface is #APEX-11's domain.

## Architecture (epic binding)

A **pure function** layer over #APEX-7. Tiers are a lookup table; catch-up is a
bounded scalar; the race simulator gains an optional reference car and telemetry.
`src/ai/` stays free of `three.js`/DOM.

```
DifficultyTier ──difficultyTuning──▶ DifficultyTuning { skill, reaction, aggression, driverTuning, catchUp }
                                             │                              │
                          scaleDriverTuning(reaction, aggression)   boundedCatchUp(skill, gap, catchUp)
                                             │                              │ ratio
                                             ▼                              ▼
                          createRaceField(circuit, { tier, cars, seed })   CpuDriver.setCatchUp(ratio)
                                             │                              │
                                             └──────── simulateRace(circuit, { tier, player, seed }) ──▶ RaceResult
                                                                                          (telemetry: maxSpeedDelta, catchUp, per-car displacement)
```

### Modules

| Module | Responsibility |
| --- | --- |
| `src/ai/difficulty.ts` (new) | `DifficultyTier`, the tier table, `difficultyTuning`, `scaleDriverTuning`, `boundedCatchUp`, `isDifficultyTier`, `COMPETENT_HUMAN_SKILL`. |
| `src/ai/driver.ts` | gains a bounded `catchUpFactor` (default `1`) applied to the target speed via `setCatchUp`; unchanged when unused. |
| `src/ai/race.ts` | `RaceOptions.tier` (scale the CPU field) and `RaceOptions.player` (reference car); per-step bounded catch-up and telemetry. |
| `src/ai/types.ts` | `RaceOptions`/`RaceResult`/`CarResult` gain the tier + telemetry fields. |
| `src/ai/index.ts` | barrel re-exports the new surface. |
| `src/scenes/aiRaceScene.ts` | accepts an optional `tier` and passes it to `createRaceField`. |

### Difficulty table (the numbers, and why)

| Tier | `skill` | `reaction` | `aggression` | `maxBoost` | `maxSlow` | `fullGapRange` | `skillCap` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `easy` | 0.80 | 0.90 | 0.70 | 0.04 | 0.020 | 60 m | 0.830 |
| `normal` | 0.92 | 1.00 | 1.00 | 0.04 | 0.020 | 50 m | 0.955 |
| `hard` | 1.02 | 1.04 | 1.10 | 0.03 | 0.015 | 45 m | 1.050 |
| `rally-legend` | 1.06 | 1.08 | 1.15 | 0.03 | 0.015 | 35 m | 1.090 |

- `skill` scales the feasible corner/straight target speed — the dominant pace axis.
  A competent reference human uses `skill = 1.0`; `easy` CPUs drive ~20 % slower,
  `rally-legend` ~6 % faster.
- `reaction = r` scales `kHeading` and `kCross` by `r`, so a lower tier reacts
  later/sloppier and a higher tier tracks the line tighter. It is deliberately mild
  so it does not dominate lap time.
- `aggression = a` scales `overtakeGain` by `a` and the following gap by `1/a`, so a
  lower tier holds back and a higher tier presses.
- `skillCap` is the tier ceiling (`skillCap < skill·(1+maxBoost)`), so a saturated
  boost is always clamped by the cap — the cap is real, not decorative.

The catch-up magnitudes are small on purpose: a large rubber-band compresses the
field and lets fast tiers overlap into each other. The shipped numbers keep the
`minSeparation > 2 m` contract (see the #APEX-32 regression guard in the tests).

### Bounded catch-up

`boundedCatchUp(baseSkill, gapMetres, cfg)` where `gap > 0` means the CPU is *behind*
the reference and `gap < 0` means it is *ahead*:

1. `u = clamp(gap / fullGapRange, -1, 1)` (a non-finite gap ⇒ `u = 0`).
2. `factor = 1 + (u ≥ 0 ? maxBoost : maxSlow)·u`.
3. `effectiveSkill = min(baseSkill·factor, skillCap)`.
4. `ratio = effectiveSkill / baseSkill`, `capped = baseSkill·factor > skillCap + ε`.

`ratio ∈ [1 − maxSlow, 1 + maxBoost]` always, and `effectiveSkill ≤ skillCap` always.
The ratio is applied to the driver's *target speed* only (`CpuDriver.setCatchUp`) —
catch-up never writes a car's position or velocity, so it cannot teleport.

### Reference player (balance oracle)

For grading `easy`/`hard`, the simulator enters a deterministic **reference human**:
a `CpuDriver` at `COMPETENT_HUMAN_SKILL` (= 1.0) with the **default** tuning (a tier's
reaction/aggression never changes the human baseline). It races the line **solo**
outside the collision field, so its finish time is a clean pace benchmark the
traffic-bound CPU pack is graded against, and a tier can never perturb the #APEX-7
pack by adding a phantom 5th car. Per fixed step, each CPU's `gap =
playerDistance − cpuDistance` drives its catch-up ratio. Win = the reference human's
`finishTime` beats every CPU's. This models a competent human's *pace*, which is
exactly what the tier bands assert; it is not a claim that the reference car is a
literal human in traffic.

### Telemetry (bounded-delta proof)

Per `RaceResult`: `tier`, `playerId`, `reference`, `maxSpeedDelta` (the largest
`|carSpeed − referenceSpeed|` over every racing step, bounded by `MAX_SPEED_DELTA`)
and `catchUp: { minRatio, maxRatio, cappedSteps }`.
Per `CarResult`: `maxSpeedDeltaFromReference` and `maxStepDisplacement` (largest
per-step ground movement, in metres, bounded by `MAX_STEP_DISPLACEMENT`) — the
no-teleport evidence.

### Interfaces

```ts
type DifficultyTier = "easy" | "normal" | "hard" | "rally-legend";
function isDifficultyTier(value: unknown): value is DifficultyTier;
function difficultyTuning(tier: DifficultyTier): DifficultyTuning;   // never throws

interface CatchUpConfig { maxBoost; maxSlow; fullGapRange; skillCap }
interface CatchUpState { factor: number; effectiveSkill: number; ratio: number; capped: boolean }
function boundedCatchUp(baseSkill: number, gapMetres: number, cfg: CatchUpConfig): CatchUpState;
function scaleDriverTuning(reaction: number, aggression: number): Partial<DriverTuning>;

const COMPETENT_HUMAN_SKILL = 1;
const MAX_SPEED_DELTA = 25;          // m/s — telemetry ceiling
const MAX_STEP_DISPLACEMENT = 1.0;   // m   — no-teleport ceiling

interface RaceOptions {
  /* …#APEX-7 options… */
  tier?: DifficultyTier;                       // scale the CPU field
  player?: { id?: string; skill?: number };    // reference pace car (solo ghost)
}
interface RaceResult { /* …#APEX-7 fields… */
  tier: DifficultyTier | null; playerId: string | null;
  reference: CarResult | null;
  maxSpeedDelta: number;
  catchUp: { minRatio: number; maxRatio: number; cappedSteps: number } | null;
}
interface CarResult { /* …#APEX-7 fields… */
  maxSpeedDeltaFromReference: number; maxStepDisplacement: number;
}
```

### Invariants

1. Tier ordering is monotone: `easy < normal < hard < rally-legend` in `skill`,
   `reaction` and `aggression`.
2. `boundedCatchUp` output is bounded by `[1−maxSlow, 1+maxBoost]` and capped by
   `skillCap`; a non-finite gap **or base skill** yields no change (`ratio = 1`).
3. Catch-up never writes a position/velocity: `maxStepDisplacement ≤ MAX_STEP_DISPLACEMENT`.
4. Every tiered race keeps `offSurfaceSamples == 0`, `maxCrossTrack ≤ roadHalfWidth`
   and `minSeparation > 2 m` (the #APEX-28 barrier plus the #APEX-32 spacing floor).
5. Omitting `tier`/`player` reproduces the #APEX-7 result exactly (back-compat).
6. Determinism: identical inputs ⇒ identical `RaceResult` (exact floats).

### Edge cases

- Unknown/undefined tier string ⇒ `difficultyTuning` returns the `normal` row.
- A tier whose `skill` is outside the driver's `[0.5, 1.3]` clamp is clamped there.
- A non-finite or missing reference distance ⇒ no catch-up that step.
- A finished reference car ⇒ racing CPUs keep the last bounded reference gap (no NaN).

## Acceptance criteria (Given/When/Then)

- **AC1 Each tier changes the driver** — Given the four tiers, When their tuning is
  read, Then `skill`, `reaction` and `aggression` are strictly ordered and the derived
  `DriverTuning` (heading gain, cross-track gain, overtake gain, following gap) differs.
- **AC2 Corner speed changes per tier** — Given the six shipped stages × seeds, When a
  race is simulated at each tier, Then the mean corner speed is strictly ordered with
  the tier (a higher tier corners faster).
- **AC3 Catch-up is capped and bounded** — Given any gap (including huge/NaN),
  When `boundedCatchUp` runs, Then `ratio ∈ [1−maxSlow, 1+maxBoost]`,
  `effectiveSkill ≤ skillCap`, a saturated boost reports `capped`, and a non-finite
  gap or base skill yields `ratio = 1`.
- **AC4 Never teleports** — Given a tiered race with a reference player, When every
  step is recorded, Then no car's per-step displacement exceeds `MAX_STEP_DISPLACEMENT`
  and no car leaves the ribbon.
- **AC5 A competent human wins on easy and can lose on hard** — Given the six shipped
  stages × many seeds, When the reference human (skill 1.0) races each tier, Then the
  win rate is ≥ 0.80 on `easy` and ≤ 0.60 on `hard`/`rally-legend`.
- **AC6 Bounded speed deltas** — Given a tiered race, When telemetry is read, Then
  `maxSpeedDelta` between the player and the pack stays inside `MAX_SPEED_DELTA` and
  the catch-up ratios stay within the tier band.
- **AC7 Back-compat + determinism** — Given no `tier`/`player`, Then the #APEX-7
  result is unchanged; given the same inputs twice, `RaceResult` is exactly equal.

## How to test

- `bun run test` — `tests/difficulty.test.ts` (AC1–AC7): tier table ordering,
  `scaleDriverTuning`, `boundedCatchUp` bounds/NaN/`capped`, seeded tiered races
  across all six stages for corner-speed ordering, win-rate bands, telemetry bounds,
  no-teleport and determinism.
- `bun scripts/ai-difficulty-report.ts` — swept gate: six stages × N seeds × four
  tiers, printing win rates, corner speeds, `maxSpeedDelta` and catch-up ratio bands;
  exits non-zero when a band is violated. Writes
  `docs/evidence/APEX-8-difficulty-report.json` + `.txt`.
- `bun run typecheck` — clean.
- `bun run build && bun scripts/screenshot-ai-race.mjs` — the visible race still runs
  (optionally `?race=<stage>&difficulty=hard`).
- Manual: `bun run dev`, open `?race=alpine-forest&difficulty=easy` vs `…=hard` and
  watch the pack pace change without any car jumping.

## Evidence

- `docs/evidence/APEX-8-difficulty-report.json` / `.txt` — per-tier win-rate bands,
  corner-speed ordering, bounded speed deltas and catch-up ratio ranges.
- `docs/evidence/APEX-8-tests.txt` — `vitest run` green.
- `docs/evidence/APEX-8-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-8-build.txt` — `vite build` succeeds.
- `docs/evidence/APEX-8-review.txt` / `APEX-8-qa.md` / `APEX-8-security.md` — gates.
