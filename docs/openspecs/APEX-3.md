# APEX-3 — Stage Race Loop: Countdown, Checkpoints, Finish and Results

Epic: `2026-Q4-APEX-RALLY-APEX-01` — Race Core & Vehicle Handling.

Depends on: **#APEX-1** (fixed-timestep engine + scene lifecycle, PR #1).
Source of crossing events: **#APEX-2** (vehicle handling) — modelled here as an injected
gate-crossing event so the loop is testable before the vehicle lands.

## Problem

A rally stage needs a defined race lifecycle — countdown, checkpoints, penalties, finish
and results — so that racing against CPUs and comparing times has meaning. Without it
there is no timer, no ordered gates, no penalty for cutting the course and no result to
compare, so a "run" cannot be measured or judged.

## Goal

Run a complete stage: a countdown that gates input and then starts the timer, a timed run
through **ordered** checkpoints, a penalty for a missed checkpoint, a finish that stops the
timer and shows position and total time, and a results view whose total equals the sum of
its splits. `restart` and `quit` return cleanly to stage select without reloading the page.

## Non-goals

- Vehicle physics / handling (#APEX-2) — the loop consumes crossing events; it does not
  move a car.
- CPU opponent AI — opponent times are static standings for position comparison.
- Audio/co-driver (#APEX-6), asset pipeline, networking, persistence of results.

## Architecture (epic binding)

The epic architecture defines "a race state machine (**countdown → racing → finished**)
owning ordered checkpoints, penalties and split times". This ticket implements exactly
that, as a **pure, headless-testable** module, plus a thin DOM HUD that renders it. The
state machine owns *all* race state; the HUD is a projection and never holds authoritative
state. Time is supplied by the fixed-timestep loop via `update(dt)`, so race timing is
frame-rate independent and deterministic in tests.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/race/types.ts` | Domain types: `RacePhase`, `StageDefinition`, `CheckpointDef`, `Split`, `RaceResult`, `Standing`. |
| `src/race/stage.ts` | `defineStage` + `validateStage`: ordered checkpoints, finish gate, countdown length, penalty rules. |
| `src/race/race.ts` | `RaceController`: the countdown → racing → finished state machine; timers, splits, penalties, finish, restart, quit. |
| `src/race/results.ts` | `formatTime`, `buildResult`, `rankStandings`: split summation and position vs fixed opponent times. |
| `src/race/hud.ts` | `RaceHud`: DOM overlay for stage select, countdown, live timer + next checkpoint, and the results table. |
| `src/race/session.ts` | `StageSession`: binds one `RaceController` to the engine `update(dt)` and a keyboard/event gate source; owns restart/quit. |
| `src/race/index.ts` | Barrel. |

### Interfaces

```ts
type RacePhase = "stage_select" | "countdown" | "racing" | "finished" | "invalidated";

interface CheckpointDef {
  id: string;          // unique gate id, e.g. "cp-1"
  index: number;       // 0-based order on the stage
  name: string;
}

interface StageDefinition {
  id: string;
  name: string;
  checkpoints: CheckpointDef[]; // ordered, index ascending
  finishId: string;             // gate id that ends the run, e.g. "finish"
  countdownSeconds: number;     // e.g. 3
  penaltySeconds: number;       // added per missed checkpoint, e.g. 5
  maxPenalties: number;         // beyond this the run is invalidated
  opponents: { name: string; time: number }[]; // fixed CPU times for position
}

interface Split {
  checkpointId: string;
  index: number;   // 0..checkpoints.length (finish = last)
  delta: number;   // seconds since the previous split
  time: number;    // cumulative race time at this split
}

interface RaceResult {
  valid: boolean;
  totalTime: number;    // sum(split.delta) + penalties
  splits: Split[];      // ordered; last is the finish
  penaltySeconds: number;
  missedCount: number;
  position: number | null; // null when invalidated
  standings: Standing[];   // player + opponents, ordered, with position
}

class RaceController {
  readonly phase: RacePhase;
  readonly inputEnabled: boolean; // false during stage_select/countdown/finished
  readonly elapsed: number;
  readonly nextCheckpoint: CheckpointDef | null;

  startStage(stage: StageDefinition): void; // stage_select -> countdown
  update(dt: number): void;                 // drives countdown + race clock
  crossGate(gateId: string): void;          // the only world -> race input
  finish(): void;                           // explicit finish (also via finishId gate)
  restart(): void;                          // countdown again, all state reset
  quit(): void;                             // -> stage_select, all state reset
  readonly result: RaceResult | null;       // set once finished/invalidated
}
```

### State machine

```
stage_select --startStage--> countdown --update==countdownSeconds--> racing
racing --crossGate(all checkpoints + finish)--> finished
racing --penalties > maxPenalties--> invalidated
finished|invalidated --restart--> countdown
finished|invalidated|racing|countdown --quit--> stage_select
```

### Invariants

1. Input is gated: `crossGate` is a **no-op** unless `phase === "racing"`.
2. The timer only advances while `racing`; countdown consumes `dt` but does not accrue
   race time. `elapsed` starts at 0 the instant racing begins.
3. Checkpoints are ordered: only the next expected checkpoint (or a later one, which
   implies skipped ones) may be crossed; already-crossed/unknown gates are ignored.
4. Each split's `delta` is the time since the previous split; `time` is cumulative, so
   `sum(splits.delta) === elapsedAtFinish` (within fp epsilon).
5. `result.totalTime === sum(splits.delta) + penaltySeconds`.
6. A missed checkpoint costs exactly `penaltySeconds`; more than `maxPenalties` missed
   invalidates the run (`valid === false`, `position === null`).
7. `restart()` re-enters countdown with **zero** residual state (elapsed, splits,
   penalties, result). `quit()` returns to `stage_select` with zero residual state.
8. `position` is `1 + count(opponent.time < totalTime)` among valid runs.
9. `update` ignores non-positive/non-finite `dt` (no NaN, no negative elapsed).

### Edge cases

- Crossing the finish **before** all checkpoints: each skipped checkpoint is penalised,
  then the run finishes (or invalidates if it exceeds `maxPenalties`).
- Crossing the same gate twice: ignored (no duplicate split/penalty).
- `startStage` while already racing: rejected (phase unchanged) — one stage at a time.
- `dt` clamped to a sane max per call so a backgrounded tab cannot inject a huge step.
- `restart`/`quit` before finishing: always safe and idempotent.
- Empty opponent list: valid run is position 1.

## Acceptance criteria (Given/When/Then)

- **AC1 — countdown gates input, then starts the timer.** Given a stage with
  `countdownSeconds = 3`, When the phase is `countdown`, Then `inputEnabled === false` and
  `crossGate` is ignored; When `update` advances past 3s, Then `phase === "racing"`,
  `inputEnabled === true` and `elapsed` starts counting from 0.
- **AC2 — checkpoints must be crossed in order.** Given racing, When the expected
  checkpoint is crossed, Then a split is recorded and `nextCheckpoint` advances; When a
  later checkpoint is crossed, Then the skipped one(s) are penalised before it is recorded;
  When an already-crossed or unknown gate is crossed, Then nothing changes.
- **AC3 — a missed checkpoint adds a penalty or invalidates.** Given a missed checkpoint,
  When the run continues, Then `penaltySeconds` is added (+1 per miss); When misses exceed
  `maxPenalties`, Then the run is `invalidated` (`valid === false`).
- **AC4 — finish stops the timer and shows position and total.** Given all checkpoints and
  the finish crossed, When the finish gate is crossed, Then `phase === "finished"`, the
  timer stops, and the result exposes `totalTime` and `position` ranked against opponents.
- **AC5 — results total equals the sum of splits.** Given any finished run, Then
  `result.totalTime === sum(result.splits.map(s => s.delta)) + result.penaltySeconds`.
- **AC6 — restart and quit return cleanly to stage select.** Given a finished/invalidated
  run, When `restart()`, Then the phase is `countdown` and every field is reset; When
  `quit()`, Then the phase is `stage_select` with zero residual state — no page reload.

## How to test

- **Unit (Vitest, headless):** `tests/race.test.ts` — one `describe` per AC, driving the
  controller with synthetic `dt` and `crossGate` calls (fake clock, deterministic).
- **Unit:** `tests/results.test.ts` — split summation, ranking, formatting.
- **Integration:** `tests/session.test.ts` — engine `tick()` drives the race clock;
  restart/quit reset cleanly; input gating via the keyboard source.
- **Browser evidence:** `bun run build && bun scripts/screenshot-race.mjs` renders the
  stage in headless Chromium (SwiftShader WebGL2): stage select → countdown → a run that
  deliberately skips a checkpoint (penalty visible) → results (total + position).
- **Gates:** `bun run typecheck` and `bun run test` must be green; evidence attached to
  the ticket.

## Evidence plan

- `bun run test` output, `tsc --noEmit` clean, `vite build` success.
- `docs/evidence/APEX-3-*.txt` (test/typecheck/build logs) and
  `docs/evidence/APEX-3-*.png` (stage select, countdown, results screenshots).
