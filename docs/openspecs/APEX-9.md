# APEX-9 — Deterministic headless simulation harness and ghost replays

Epic: `2026-Q4-APEX-RALLY-APEX-03` — CPU Opponents & Racing Balance.
Consumes: **#APEX-7** (`simulateRace`, `CpuDriver`, `RacingLine`, `RaceResult`),
**#APEX-4** (`StageCircuit` + checkpoint `t` data) and **#APEX-2** (`Vehicle`).
Unblocks/enables: **#APEX-8** (difficulty tiers tuned against a reproducible harness).

## Problem

AI tuning and regression protection need reproducible races that run in CI without a
GPU. #APEX-7 makes a single race deterministic in principle, but there is no runner
that records the outcome, no serialisable **replay trace** to diff across runs, no
splits/finish-order artifact, and no ghost overlay. Without those, "the race got
faster" or "the car left the road" cannot be reproduced or protected against a
regression.

## Goal

A deterministic, headless simulation harness replays a seed and stage to the same
outcome, and captures a ghost/replay trace. Concretely: a CI job runs seeded races
and asserts identical results across runs, plus a ghost replay that can be raced
against a recorded run.

## Non-goals

- **Difficulty tiers / bounded catch-up** — #APEX-8. This ticket exposes the recorded
  `skill` in the trace and split table but does not define tiers.
- **New driver AI or physics** — #APEX-7/#APEX-2. The harness re-uses `simulateRace`.
- **Network replay sharing / cloud storage** — traces are local JSON artifacts.
- **Frame-perfect networked rollback** — fixed-step single-process determinism only.
- **Changing rendering behaviour** — the ghost is an additive renderer over the same
  scene; the authoritative race remains `simulateRace`.

## Architecture (epic binding)

The epic binds "a deterministic headless simulation harness seeding all randomness for
tuning, CI and ghost replays". This ticket adds a pure `src/ai/trace.ts` (the trace
format + interpolation, browser-safe), a pure `src/ai/replay.ts` (canonical
serialization + content hash, node-only) and a pure `src/ai/harness.ts` (the runner
that ties `simulateRace` to a recorder), and surfaces the trace in the visible scene
through `src/ai/ghost.ts`.

```
StageCircuit ─▶ simulateRace(circuit, {seed, cars, onStep}) ─▶ RaceResult
                        │ onStep(TraceFrame)                        │
                        ▼                                          ▼
                 frames[] + splits[]  ──recordTrace──▶  RaceTrace ──serializeTrace──▶ JSON
                                                            │                            │
                                                     traceHash (sha256)           parseTrace
                                                            │                            │
                                                   CI determinism gate          sampleGhost(t)
                                                                                        │
                                                                          ghost overlay (scene)
```

`src/ai/trace.ts` and `src/ai/ghost.ts` are browser-safe (no `node:` imports) so the
visible scene can render a ghost; `src/ai/replay.ts` and `src/ai/harness.ts` are
node-only. None import `three.js` or the DOM, so the harness runs in Vitest, Bun and CI.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/ai/trace.ts` | `TracePose`, `TraceFrame`, `TraceSplit`, `RaceTrace`, `sampleGhost`. Pure, browser-safe interpolation. |
| `src/ai/replay.ts` | `recordTrace`, `serializeTrace`, `parseTrace`, `traceHash` (sha-256). Pure, node-only canonical JSON + hash. |
| `src/ai/harness.ts` | `runHeadlessRace(circuit, opts)`: drive `simulateRace` with a recorder, derive checkpoint splits from progress crossings, return `{ result, trace, splitTable, hash }`. `runHeadlessRaceFromLibrary`. |
| `src/ai/ghost.ts` | `GhostOverlay`: interpolate a `RaceTrace` at a simulation time and expose car poses + cumulative split/position readout. Pure, renderer-agnostic. |
| `src/ai/race.ts` (extended) | Optional `onStep(frame)` recorder callback; frames captured after car updates, before the time increment; unchanged when no callback. |
| `src/scenes/aiRaceScene.ts` (extended) | Optional `ghost?: RaceTrace`; renders semi-transparent ghost cars sampled with `sampleGhost` at the scene's simulation time. |
| `scripts/headless-race.ts` | CLI: run seeded races over every stage, write `docs/evidence/APEX-9-determinism.json`/`.txt`, exit non-zero on any determinism or contract failure. |
| `.github/workflows/determinism.yml` | CI job: `bun run harness:check` (seeded races, asserts identical results across two runs). |

### Trace format (v1, normative)

```ts
interface TracePose { x: number; z: number; yaw: number; speed: number; progress: number }
interface TraceFrame { step: number; time: number; cars: TracePose[] } // stable id order
interface TraceSplit { carId: string; checkpointId: string; progressT: number; time: number }
interface RaceTrace {
  version: 1; generator: "apex-rally"; stageId: string; seed: number; dt: number;
  sampleEvery: number; referenceTime: number; window: [number, number];
  finishOrder: string[]; splits: TraceSplit[]; frames: TraceFrame[];
}
```

- **Canonical serialization.** `serializeTrace` writes a fixed key order and finite
  doubles, so the JSON bytes (and hence `traceHash`) are reproducible across runs and
  platforms. `traceHash` is the SHA-256 hex of those bytes.
- **Interpolation.** `sampleGhost(trace, time)` finds the bracketing frames, linearly
  interpolates `x, z, speed, progress` and slerp-free interpolates `yaw` by shortest
  angle; it returns the first/last frame outside the range and `null` for an empty trace.
- **Splits.** For each car, a split is recorded at each checkpoint (`circuit.checkpoints`,
  `t` arc fraction) the first time the car's progress fraction ≥ `t`, in checkpoint
  order; the finish is the implicit final split. `splitTable` maps `carId → cumulative
  seconds` indexed by checkpoint order (finish last).

### Determinism

`runHeadlessRace` is a pure function of `(circuit, cars, seed, dt, sampleEvery)`. Two
runs in the same process, and two separate processes, must produce equal
`serializeTrace(trace)` strings and equal `hash`. No `Date.now`, no `Math.random`, no
`node:crypto` randomness (SHA-256 is deterministic), no iteration-order-dependent
collections.

### Interfaces

```ts
function simulateRace(circuit: StageCircuit, options?: RaceOptions): RaceResult;
// RaceOptions gains: onStep?: (frame: TraceFrame) => void

function runHeadlessRace(circuit: StageCircuit, options?: HeadlessRaceOptions): HeadlessRace;
function runHeadlessRaceFromLibrary(library: StageLibrary, stageId: string, options?: HeadlessRaceOptions): HeadlessRace;

function recordTrace(result: RaceResult, frames: TraceFrame[], splits: TraceSplit[], opts: { sampleEvery: number }): RaceTrace;
function serializeTrace(trace: RaceTrace): string;
function parseTrace(json: string): RaceTrace;
function traceHash(trace: RaceTrace): string;
function sampleGhost(trace: RaceTrace, time: number): TraceFrame | null;

class GhostOverlay {
  constructor(trace: RaceTrace);
  poseAt(time: number): TraceFrame | null;
  readonly finishOrder: string[];
}
```

### Invariants

1. **Determinism:** identical `(circuit, cars, seed, dt)` ⇒ identical `RaceResult` and
   identical `traceHash`. A different seed may legitimately differ.
2. **Round-trip:** `parseTrace(serializeTrace(t))` deep-equals `t`, and
   `traceHash(parseTrace(serializeTrace(t))) === traceHash(t)`.
3. **Recording is inert:** passing `onStep` does not change `RaceResult` (the callback
   only observes).
4. **Finish order agrees:** `trace.finishOrder` equals `result.finishOrder`.
5. **Splits are ordered and monotone:** per car, split times are non-decreasing and the
   checkpoint ids appear in `circuit.checkpoints` order; the final split is the finish.
6. **Ghost sampling is bounded:** `sampleGhost` never returns a time outside the trace
   and interpolates within the recorded poses; `null` only for an empty trace.
7. **On-surface preserved:** a seeded harness run keeps `offSurfaceSamples === 0` and
   `minSeparation > 2.0` on every shipped stage (#APEX-7 contract, re-asserted here).

### Edge cases

- Empty trace (`frames.length === 0`): `sampleGhost` returns `null`; `serializeTrace`/
  `parseTrace` handle it without throwing.
- Single-frame trace: `sampleGhost` returns that frame for any time.
- A car that does not finish (`finishTime === null`): it contributes no finish split;
  `splitTable` leaves the finish entry `null`/absent and `complete` is `false`.
- `sampleEvery = 1` captures every fixed step (large traces); the CLI uses a coarse
  cadence by default to keep artifacts small.
- Unknown `version` on parse: `parseTrace` throws a typed error (never silent misuse).

## Acceptance criteria (Given/When/Then)

- **AC1 Identical results across runs** — Given a seeded stage and car field, When the
  headless runner runs twice (same process and a fresh process), Then `finishOrder`,
  per-car finish times and `traceHash` are exactly equal.
- **AC2 Replay trace captured** — Given a race, When it is recorded, Then the trace has
  one frame per `sampleEvery` steps with a pose for every car in stable id order, plus
  a finish order and checkpoint splits.
- **AC3 Trace round-trips** — Given a trace, When serialised and parsed, Then it
  deep-equals the original and re-serialises to the same hash.
- **AC4 Ghost can be raced against a recorded run** — Given a recorded trace, When
  `GhostOverlay.poseAt(t)` / the scene ghost overlay samples it, Then it returns the
  recorded poses at the recorded times, interpolated between frames, and the overlay's
  finish order matches the recording.
- **AC5 CI determinism gate** — Given the repo, When `bun run harness:check` runs on CI
  with no GPU, Then it runs seeded races on every shipped stage and exits non-zero if
  any stage's two runs diverge or the #APEX-7 contract (on-surface, separation, window)
  fails.
- **AC6 Nothing regressed** — Given the existing suite, When `bun run typecheck` and
  `bun run test` run, Then they are green and the visible race scene still boots.

## How to test

- `bun run test` — `tests/ai-replay.test.ts` (determinism across two runs and two
  processes, trace round-trip/hash, ghost interpolation, split ordering, recording is
  inert) plus the existing `tests/ai-race.test.ts`.
- `bun run harness:check` — the swept gate: every shipped stage × seeds, two runs each,
  enforcing AC1–AC2 and the #APEX-7 contract, printing `VERDICT: PASS|FAIL` and writing
  `docs/evidence/APEX-9-determinism.json`/`.txt`.
- `bun run typecheck` — clean.
- `bun run build && bun run screenshot:ghost` — renders the visible race with a recorded
  ghost in headless Chromium and writes `docs/evidence/APEX-9-ghost.png`.
- Manual: `bun run dev`; race a stage, then reload with the recorded ghost and watch the
  ghost lap the same line.

## Evidence

- `docs/evidence/APEX-9-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-9-tests.txt` — Vitest green (incl. the replay/determinism suite).
- `docs/evidence/APEX-9-determinism.json` / `.txt` — per-stage two-run hashes and the
  contract verdicts; `ALL OK: true`.
- `docs/evidence/APEX-9-ghost.png` — headless Chromium capture of the ghost overlay.
- `docs/evidence/APEX-9-review.txt` — code review notes.
- `docs/evidence/APEX-9-security.txt` — security review notes.
- `docs/evidence/APEX-9-qa.txt` — QA verdict against the acceptance criteria.
