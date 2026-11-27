# APEX-10 — Race HUD: Speed, Time, Splits, Position and Minimap

Epic: `2026-Q4-APEX-RALLY-APEX-04` — Best-in-Class UI/UX (see the binding
[epic architecture](../architecture/2026-Q4-APEX-RALLY-APEX-04.md)).

Depends on: **#APEX-3** (race loop, PR #2 merged) for phases/timing; **#APEX-1**
(engine) for the render clock; **#APEX-2** (vehicle telemetry) as the *source* of
speed — consumed through a port so the HUD is testable before in-world vehicle
integration lands (same pattern as #APEX-3's injected gate crossings).

## Problem

Racing feedback lives in the HUD, but the current overlay only shows a raw timer,
the next checkpoint and a results table. A player cannot judge **speed**, **position**
or **progress**, gets no colour feedback on whether a sector was fast or slow, has no
map, and a screen-reader user gets nothing at all.

## Goal

A readable rally HUD that, at a glance, shows **speed**, **stage/total time**, the
**current split delta** and **next split**, **position**, and a **minimap** with the
player's progress — with clear countdown and finish states. It scales from a 320 px
phone to 4K without occluding the racing line, animates split deltas green/red, and
exposes a screen-reader summary of race state.

## Non-goals

- In-world vehicle↔scene integration / camera rig (tracked separately, #APEX-16/#APEX-17);
  speed arrives through a `TelemetrySource` port whose browser default is a keyboard
  harness, mirroring #APEX-3's harness for gate crossings.
- Menus / stage select restyle (#APEX-11); gamepad/touch remapping (#APEX-12).
- Pace notes / co-driver audio (#APEX-6); persistence of results.

## Architecture (epic binding)

Everything renders as a **canvas-independent DOM/SVG overlay** driven by a **pure
view model**. The HUD never owns race state: `RaceController` stays authoritative
(`src/race/race.ts`), the stage supplies the minimap path (`StageWorld.minimap`), and
physics supplies speed through a port. The DOM layer only paints tokens and class
names; all formatting/delta/position logic lives in `hud-model.ts` so it is
unit-testable headlessly (vitest `environment: "node"`).

### Modules

| Module | Responsibility |
| --- | --- |
| `src/race/types.ts` | Add `ReferenceSplit` and the optional `referenceSplits` target pace on `StageDefinition`. |
| `src/race/results.ts` | `referenceTimeAt`, `splitDelta`, `positionForTime`, `formatSpeed`, `formatDelta`. |
| `src/race/race.ts` | Add `progressRatio`, `projectedPosition`, `lastSplit` (read-only projections). |
| `src/race/hud-model.ts` | **New.** DOM-free view model: `buildHudState(controller, telemetry)` + `minimapDot`. |
| `src/race/telemetry.ts` | **New.** `HudTelemetry` port + `createTelemetryHarness` (keyboard-driven `Vehicle`). |
| `src/race/hud.ts` | Rewrite overlay: design tokens, corner layout, speed/time/position/split panels, SVG minimap, SR live region. |
| `src/race/index.ts` | `bootRace` accepts a `telemetry` source; steps the harness on `update`. |
| `src/main.ts` | Wire the keyboard telemetry harness into `bootRace`. |

### Interfaces

```ts
interface ReferenceSplit { checkpointId: string; time: number } // cumulative target
interface StageDefinition { /* … */ referenceSplits?: ReferenceSplit[] }

interface HudTelemetry { speedKmh: number }
type TelemetrySource = () => HudTelemetry

type SplitDirection = "ahead" | "behind" | "even";

interface HudState {
  phase: RacePhase;
  speedText: string;     // "128" (km/h, unit rendered separately)
  timeText: string;      // "1:07.482"
  positionText: string;  // "P2" | "P–"
  nextText: string;      // next checkpoint name | "to finish"
  split: { text: string; direction: SplitDirection } | null;
  progress: { x: number; y: number } | null; // normalised 0..1 minimap dot
  srSummary: string;     // full sentence for the live region
  srKey: string;         // coarse change key; SR region writes only when it changes
}

function buildHudState(controller: RaceController, telemetry: HudTelemetry): HudState;
function minimapDot(points: readonly Vec2[], ratio: number): { x: number; y: number } | null;
```

### Projections (definitions)

- `progressRatio` — fraction of the route completed by race time:
  `referenceTimeAt(lastGate) / referenceTotal` when a reference exists, else
  `lastCrossedIndex / gateCount`; `0` before the first split, `1` at finish.
- `projectedPosition` — `1 + count(opponent.time < elapsed / progressRatio)`, shared
  ties; `null` until the first split (no dishonest position on the line).
- `splitDelta` — `actual cumulative time − reference cumulative time` at the same gate.

### Edge cases

- No `referenceSplits` on the stage: no delta is shown; position/progress fall back to
  the gate-index ratio (still no position before the first split).
- Reference times missing for a gate: that split has no delta (rendered as `–`).
- `speedKmh` non-finite/negative: rendered as `0`; telemetry port absent: HUD shows
  speed `–` and hides the minimap dot until progress is known.
- `formatTime`/deltas clamp negatives so a bad value can never render `-0:0-1`.
- Narrow (≤480 px) viewports: panels shrink via `clamp()` and corner anchoring; the
  central 50 % band stays empty. Reduced-motion disables the delta flash.

## Acceptance criteria (Given/When/Then)

- **AC1 — at-a-glance racing state.** Given a racing run with telemetry, Then the HUD
  shows speed, total time, position, the next checkpoint and the minimap with a player
  dot; Given a finish, Then it shows the result position and total (existing behaviour
  preserved).
- **AC2 — responsive 320 px → 4K.** Given the HUD at 320 px wide and at 3840 px wide,
  Then every element is legible (font within bounds) and no two HUD panels overlap.
- **AC3 — no occlusion of the racing line.** Given default settings, Then no HUD panel
  intersects the central band (x ∈ [25 %, 75 %], y ∈ [25 %, 75 %]) at either width.
- **AC4 — split deltas animate green/red.** Given a split faster than the reference,
  Then the delta is negative, marked "ahead" and painted green; Given a slower split,
  Then it is positive, "behind" and painted red; both carry a sign **and** a glyph so
  colour is not the only signal; the flash is suppressed under `prefers-reduced-motion`.
- **AC5 — screen-reader summary.** Given the race state changes (phase, split, position,
  coarse time), Then a polite live region exposes an up-to-date sentence describing the
  race, and its text changes only on coarse state changes (never per frame).

## How to test

- **Unit (Vitest, headless):** `tests/hud-model.test.ts` — `buildHudState` per phase,
  delta direction/test, position gating, minimap dot endpoints, SR key cadence;
  `tests/results.test.ts` + `tests/race.test.ts` — reference helpers, `progressRatio`,
  `projectedPosition`, `lastSplit`, reference validation.
- **Browser evidence:** `bun run build && bun scripts/screenshot-race.mjs` — now also
  asserts the racing HUD panels, and `bun scripts/screenshot-hud.mjs` measures
  non-overlap + central-band clearance at 320 px and 3840 px and captures screenshots.
- **Gates:** `bun run typecheck` and `bun run test` green; evidence attached.

## Evidence plan

- `docs/evidence/APEX-10-tests.txt`, `APEX-10-typecheck.txt`, `APEX-10-build.txt`.
- `docs/evidence/APEX-10-hud-320.png`, `APEX-10-hud-4k.png` (racing + results).
- `docs/evidence/APEX-10-responsive.txt` (measured non-overlap / central-band report).
- `docs/evidence/APEX-10-security.md` (DOM-injection, no network, reduced-motion).
