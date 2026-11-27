# APEX-7 — CPU Opponent Driver AI on the Racing Line

Epic: `2026-Q4-APEX-RALLY-APEX-03` — CPU Opponents & Racing Balance.
Consumes: **#APEX-2** (arcade vehicle + surface grip, `Vehicle.step(input, dt, surface)`)
and **#APEX-4** (`StageCircuit` + `sampleSpline` arc-length centreline).
Unblocks: **#APEX-8** (difficulty tiers / catch-up) and **#APEX-9** (headless harness /
ghost replays) — both read the driver + race result types defined here.

## Problem

The game is raced against CPUs, but no opponent can drive a circuit. There is no
controller that follows a racing line, no braking for corners, no awareness of other
cars, and no way to simulate a race headlessly. A stage ships with a road ribbon and
surface zones (#APEX-4) and a drivable car (#APEX-2), but nothing turns those into a
race: every stage is an empty time-trial.

## Goal

CPU drivers follow the racing line, brake for corners, avoid each other and race
credibly on every stage. A headless four-car race completes each stage with every car
on the road surface, corner speeds below straight speeds, no cars driving through each
other, finish times inside a per-stage target window, and bit-for-bit determinism for a
given seed.

## Non-goals

- **Difficulty tiers and bounded catch-up** — #APEX-8. This ticket exposes a bounded per-car
  `skill` scalar and an optional PRNG skill jitter; it does not define the tiers.
- **Ghost replays / replay capture** — #APEX-9. The result type records deterministic
  trajectories so #APEX-9 can serialise them, but this ticket ships no replay format.
- **Race state machine, countdown, checkpoint penalties** — #APEX-3. We only detect the
  finish (arc progress reaches `finish.t`).
- **Vehicle-car collision response / damage** — none exists in #APEX-2; the AI must avoid
  contact defensively, and the harness *detects* the minimum separation rather than resolving it.
- **Learning / ML driving** — the controller is a deterministic geometric controller, not a
  trained model.

## Architecture (epic binding)

The epic binds "CPU drivers follow the racing line, brake for corners, avoid each other
and race credibly on every stage". This ticket implements that as a **pure, headless**
`src/ai/` pipeline layered on the #APEX-2 vehicle and the #APEX-4 sampled centreline: the
racing line is derived from the spline, the driver commands a `VehicleInput` from geometric
feedback, and the race simulator threads both together with no renderer and no wall clock.

```
StageCircuit ──sampleSpline──▶ SampledSpline ──buildRacingLine──▶ RacingLine
                                        (offsets + curvature + feasible target-speed profile)
                                                                      │
VehicleInput ◀──CpuDriver.control── car state ─┐                      │
      │                                        │                      ▼
      └── Vehicle.step(input, dt, surface) ────┘         simulateRace(circuit, {cars, seed})
                    ▲                                          │
             physicsSurfaceAt(circuit, t)                      ▼
                                              RaceResult { cars[], finishOrder, minSeparation }
```

The module imports **only** `src/physics` and `src/stage` — no `three.js`, no DOM — so the
whole race runs in Vitest with no GPU. The visible race lives in `src/scenes/aiRaceScene.ts`
(a thin renderer over the same `simulateRace` logic) and is captured by
`scripts/screenshot-ai-race.mjs`.

### Modules (`src/ai/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | `RacingLinePoint`, `RacingLine`, `CpuCarSpec`, `CarResult`, `RaceResult`, `RaceOptions`. |
| `racing-line.ts` | `buildRacingLine(circuit, spline, opts)`: corner-cutting lateral offset, signed curvature, feasible target-speed profile (lateral cap → brake pass → acceleration pass), `referenceTime`. |
| `surface.ts` | `physicsSurfaceAt(circuit, t)`: map a stage surface zone (`grip`, type) to a `physics.Surface` so the car grips what the road paint shows. |
| `driver.ts` | `CpuDriver`: pure-pursuit steering + cross-track correction + speed control + opponent separation/overtake; owns per-car arc-progress projection. |
| `race.ts` | `simulateRace(circuit, { cars, seed, dt, maxSeconds })`: grid placement, fixed-step loop, finish detection, on-surface + separation accounting, deterministic results. |
| `rng.ts` | `mulberry32` seeded PRNG (deterministic skill jitter; no `Math.random`). |
| `index.ts` | Barrel. |

### Racing line

- **Offset** cuts the inside of a corner: `offset_i = clamp(−sign(k_i)·gain·|k_i|, ±maxOffset)`
  then smoothed, so the line is shorter than the centreline but never leaves the ribbon
  (`maxOffset = 0.6·roadHalfWidth`).
- **Curvature** `k_i` is the signed heading change between adjacent samples over the arc step:
  `k_i = wrapAngle(yaw_{i+1} − yaw_i) / ds_i` (`+` = right-hand bend).
- **Target speed** starts at the lateral limit `v_i = √(grip_i·g·efficiency / max(|k_i|, ε))`,
  capped at `vMax`; a **backward pass** enforces `v_i ≤ √(v_{i+1}² + 2·aBrake·ds)` (brake *before*
  the corner) and a **forward pass** enforces `v_i ≤ √(v_{i-1}² + 2·aAccel·ds)` (accelerate *out*).
  This is what makes the car slow for tight corners and accelerate on straights.
- `referenceTime = Σ ds / v̄` is the ideal lap time used to derive the per-stage target window.

### Driver controller (per fixed step)

1. **Progress** — project the car onto the line by scanning a small forward window from the
   last index (monotonic, deterministic); cross-track `e = (pos − linePos)·normal` (`+` = right).
2. **Pure-pursuit steering** — lookahead `L = clamp(L₀ + kSpeed·speed, Lmin, Lmax)`; target the
   point at `distance + L`; `steer = clamp(kHeading·wrapAngle(headingToTarget − yaw) − kCross·e, −1, 1)`.
3. **Speed control** — target the line speed × `skill`, then throttle/brake toward it
   (`throttle = kThrottle·(vTarget − v)⁺`, `brake = kBrake·(v − vTarget)⁺`).
4. **Separation / overtake** — for each opponent ahead within `avoidRange` and within a car width
   laterally: cap `vTarget` to the opponent's speed as the gap closes, and steer toward the side
   with room. A hard `minGap` keeps a safe following distance; finished cars are ignored.

### Determinism

`simulateRace` is a pure function of `(circuit, cars, seed, dt)`. It uses the fixed `dt` only,
iterates cars in a stable id order, and the sole randomness is a seeded `mulberry32` stream used
for skill jitter. No `Date.now`, no `Math.random`, no iteration-order-dependent collections.

### Interfaces

```ts
interface RacingLinePoint {
  index: number; position: Vec3; tangent: Vec3; normal: Vec3;
  curvature: number;        // 1/m, signed (+ right)
  targetSpeed: number;      // m/s, feasible after brake/accel passes
  offset: number;           // m from centreline (+ right)
  distance: number;         // m from start
}
interface RacingLine {
  points: RacingLinePoint[]; length: number; referenceTime: number;
  sampleAtDistance(d: number): RacingLinePoint;
  indexAtDistance(d: number): number;
}

interface CpuCarSpec { id: string; skill?: number; lineOffset?: number; }

class CpuDriver {
  readonly id: string; readonly vehicle: Vehicle;
  get distance(): number; get finished(): boolean; get finishTime(): number | null;
  control(line: RacingLine, surface: Surface, opponents: CpuDriver[]): VehicleInput;
}

function buildRacingLine(circuit: StageCircuit, spline: SampledSpline, opts?): RacingLine;
function physicsSurfaceAt(circuit: StageCircuit, t: number): Surface;
function simulateRace(circuit: StageCircuit, opts?: RaceOptions): RaceResult;
```

### Invariants

1. `simulateRace` is pure/deterministic: identical inputs ⇒ identical `RaceResult` (exact floats).
2. No driver leaves the ribbon: for every unfinished step `|cross-track| ≤ roadHalfWidth`.
3. Corner speed < straight speed on every stage (the speed profile is curvature-limited).
4. `minSeparation > minGap` — no two cars occupy the same point (no driving through each other).
5. The controller never emits a non-finite input; `steer ∈ [−1,1]`, `throttle,brake ∈ [0,1]`.

### Edge cases

- Zero-length or degenerate spline (`count < 2`, `length ≈ 0`): `buildRacingLine` returns a
  single-point line; `sampleAtDistance` clamps.
- A car pushed wide still steers back: cross-track correction is additive and bounded.
- Cars finish in any order; a finished car stops steering and is removed from avoidance.
- `maxSeconds` reached with a car unfinished ⇒ `finishTime: null` and the result is marked
  incomplete (the test asserts this never happens on a shipped stage).

## Acceptance criteria (Given/When/Then)

- **AC1 Complete without leaving the road** — Given a headless four-car race on each of the six
  shipped stages, When simulated to completion, Then every car finishes and every recorded step
  has `|cross-track| ≤ roadHalfWidth`.
- **AC2 Corner braking** — Given a stage, When the race runs, Then the mean speed inside
  corner samples (|k| above threshold) is strictly below the mean speed on straight samples,
  and the target-speed profile is monotone in curvature.
- **AC3 Avoid driving through each other** — Given the four-car race, When the minimum pairwise
  centre distance over the run is measured, Then it stays above the car-separation floor.
- **AC4 Finish-time window** — Given each stage's `referenceTime`, When the race finishes,
  Then every car's finish time lies inside `[lowFactor·ref, highFactor·ref]`.
- **AC5 Determinism** — Given the same `(circuit, cars, seed, dt)`, When the race is simulated
  twice, Then the finish times and trajectories are exactly equal; a different seed may differ.
- **AC6 Visible race** — Given the built app, When the AI race scene runs in headless Chromium,
  Then four cars are rendered on the road and a screenshot is captured as evidence.

## How to test

- `bun run test` — `tests/ai-racing-line.test.ts`, `tests/ai-driver.test.ts`,
  `tests/ai-race.test.ts` (four-car race over all six shipped stages: finish, on-surface,
  separation, corner-vs-straight, window, determinism).
- `bun run typecheck` — clean.
- `bun run build && bun scripts/screenshot-ai-race.mjs` — renders the visible race in headless
  Chromium (SwiftShader WebGL2) and writes `docs/evidence/APEX-7-race.png`.
- Manual: `bun run dev`; watch four CPU cars take the start, brake into the hairpin, hold a
  gap and pull away on the straight.

## Evidence

- `docs/evidence/APEX-7-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-7-tests.txt` — Vitest green (142/142, incl. the six-stage
  four-car race) and `vite build` succeeds.
- `docs/evidence/APEX-7-race-report.json` / `.txt` — per-stage race results
  (finish times, min separation, off-surface count, reference window); `ALL OK: true`.
- `docs/evidence/APEX-7-race-alpine-forest.png` / `APEX-7-race-canyon-sprint.png` —
  1280×720 WebGL2 visible four-car races.
- `docs/evidence/APEX-7-screenshot.txt` — headless capture run output (`ok: true`).
- `docs/evidence/APEX-7-security.txt` — security review notes.
- `docs/evidence/APEX-7-review.txt` — code review notes.
