# Epic architecture — `2026-Q4-APEX-RALLY-APEX-03` CPU Opponents & Racing Balance

Binding design for every ticket under this epic. If a ticket needs to diverge, it
updates this document first, then the code (SDD rule: spec → change → test → validate).

## Goal

CPU drivers race credibly on every stage, difficulty tiers tune skill and bounded
catch-up, and races stay close but fair — **and every one of those claims is
measurable**, because tuning and regression protection need races that are
reproducible in CI without a GPU.

## Principles

1. **Simulation is separate from rendering.** The authoritative race lives in
   `src/ai` (pure TypeScript over `src/physics` + `src/stage`): no `three.js`, no DOM,
   no wall clock. `src/scenes/aiRaceScene.ts` is a *thin renderer* over the same field.
   The harness can therefore run the whole race in Vitest / Bun / CI.
2. **All randomness is seeded.** The only entropy is a `mulberry32` stream seeded from
   `RaceOptions.seed`. `Math.random`, `Date.now`, `performance.now`, `Set`/`Map`
   iteration order and floating-time integration are forbidden inside `src/ai`.
3. **Same seed + same stage ⇒ bit-identical result.** Determinism is not a nice-to-have:
   it is the contract #APEX-8 tunes against, #APEX-9 records and CI enforces. A result
   and its trace have a **content hash**; two runs must hash equal.
4. **Racing line first, speed feasible.** A racing line is derived from the sampled
   centreline (corner-cutting offset + signed curvature + brake/accel speed profile);
   drivers command a `VehicleInput` by geometric feedback against it. Corner speed is
   always below straight speed, and no car leaves the ribbon.
5. **Balance is bounded, not rubber-banded.** Difficulty is a parameterised `skill`
   scalar (corner speed / reaction / aggression) under a hard cap; catch-up can never
   make a car exceed the physical grip envelope. Fair > close.
6. **Evidence is the deliverable.** Every balance/tuning change ships with the swept
   seed report and a falsifiable check (separation floor, finish window, off-surface
   count), not a screenshot alone.

## System shape

```
                      StageCircuit (#APEX-4)  +  Vehicle / surface (#APEX-2)
                                │
        sampleSpline ──▶ buildRacingLine ──▶ RacingLine (offsets, curvature, vProfile)
                                │
   CpuDriver.control(line, surface, opponents) ──▶ VehicleInput
                                │
                         Vehicle.step(input, dt, surface)
                                │
              simulateRace(circuit, {cars, seed, dt, onStep?})
                                │
        ┌───────────────────────┼───────────────────────────┐
        ▼                       ▼                           ▼
  RaceResult            RaceTrace (replay)            determinism hash
  (finishOrder,         (per-step car poses,          (content hash of
   splits, metrics)      checkpoint splits)            result + trace)
        │                       │
        ▼                       ▼
  src/race/results.ts     ghost overlay (src/ai/ghost.ts → scene)
  HUD splits              replay a recorded run against a live one
```

## Interfaces owned by this epic

```ts
// src/ai/types.ts — result + options (owned by #APEX-7, extended by #APEX-9)
interface RaceResult {
  stageId: string; seed: number; dt: number
  cars: CarResult[]; finishOrder: string[]; minSeparation: number
  referenceTime: number; window: [number, number]; complete: boolean
}
interface RaceOptions {
  cars?: CpuCarSpec[]; driverTuning?: Partial<DriverTuning>
  seed?: number; dt?: number; maxSeconds?: number
  windowLowFactor?: number; windowHighFactor?: number
  /** #APEX-9: capture a per-step replay frame (pure callback, no I/O). */
  onStep?: (frame: TraceFrame) => void
}

// src/ai/replay.ts — replay format (#APEX-9)
interface TracePose { x: number; z: number; yaw: number; speed: number; progress: number }
interface TraceFrame { step: number; time: number; cars: TracePose[] }   // cars in stable id order
interface TraceSplit { carId: string; checkpointId: string; progressT: number; time: number }
interface RaceTrace {
  version: 1; generator: "apex-rally"; stageId: string; seed: number; dt: number
  sampleEvery: number                       // capture one frame every N fixed steps
  referenceTime: number; window: [number, number]
  finishOrder: string[]
  splits: TraceSplit[]                      // one per car × checkpoint (in crossing order)
  frames: TraceFrame[]
}
function recordTrace(result, frames, splits, opts): RaceTrace
function serializeTrace(trace): string      // canonical JSON, stable key order
function parseTrace(json): RaceTrace        // validates + normalises; never throws on shape
function traceHash(trace): string           // sha-256 (node:crypto), 64 hex chars
function sampleGhost(trace, time): TraceFrame | null  // interpolated pose at t

// src/ai/harness.ts — headless runner (#APEX-9)
interface HeadlessRaceOptions extends RaceOptions {
  sampleEvery?: number; checkpoints?: readonly { id: string; t: number }[]
}
interface HeadlessRace {
  result: RaceResult; trace: RaceTrace; splitTable: Record<string, number[]>
  hash: string
}
function runHeadlessRace(circuit, opts?): HeadlessRace
function runHeadlessRaceFromLibrary(library, stageId, opts?): HeadlessRace
```

## Determinism rules (normative)

1. `simulateRace` iterates cars in **input order** (grid slots), never over a `Set`.
2. `onStep` fires **after** the step's vehicle updates and before `time += dt`, so a
   captured frame exactly describes step `n` starting at `time`.
3. `serializeTrace` emits numbers with `Number.prototype.toPrecision(17)`-equivalent
   round-tripping (JSON of a finite `number` is exact for doubles) and a **fixed key
   order**, so the byte string — and therefore `traceHash` — is reproducible.
4. Traces are versioned (`version: 1`); a hash mismatch across runs on the same
   code+input is a CI failure, not a warning.
5. Splits are recorded when a car's arc progress first crosses a checkpoint's `t`
   (half-open `[t, next)`), in a deterministic per-car then checkpoint order.

## Ticket map

| Ticket | Contributes |
| --- | --- |
| #APEX-7 | CPU driver AI on the racing line — the deterministic `simulateRace` core this epic builds on (delivered). |
| #APEX-8 | Difficulty tiers + fair bounded catch-up — parameterised `skill` tuning against the seeded harness. |
| #APEX-9 | Deterministic headless harness + ghost replays — records traces, splits and finish order; CI determinism gate; ghost overlay. |
| #APEX-27 / #APEX-31 / #APEX-32 | Bug fixes: containment (ribbon), finish window and car separation — all verified through this harness. |

## Epic acceptance (inherited by tickets)

- A CPU four-car race completes every shipped stage with all cars on-surface, in the
  per-stage finish window, and pairwise separation above the floor (#APEX-7).
- Difficulty tiers tune skill and bounded catch-up without breaking any of the above
  (#APEX-8).
- A seeded race is **reproducible**: identical `RaceResult` and identical `traceHash`
  across runs, in CI, with no GPU and no network (#APEX-9).
- A recorded run can be replayed as a ghost and raced against a fresh deterministic run
  (#APEX-9).
