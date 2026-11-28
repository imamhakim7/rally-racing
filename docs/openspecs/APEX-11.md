# APEX-11 — Menus, Stage Select, Settings and First-Run Tutorial

Epic: `2026-Q4-APEX-RALLY-APEX-04` — Best-in-Class UI/UX (see the binding
[epic architecture](../architecture/2026-Q4-APEX-RALLY-APEX-04.md)).

Depends on: **#APEX-10** (HUD, merged) for the race phases and the results table;
**#APEX-3** (race loop + `StageSession`) for start/restart/quit; **#APEX-14**
(support screen) for the DOM-overlay pattern. Unblocks **#APEX-12** (input/a11y),
which rebases onto this branch and layers remapping/WCAG on the same settings store.

## Problem

First impressions are set by the menus, and there are none: the game boots straight
into a minimal `<select>` drop-down over a live scene, a new player cannot preview a
stage, nothing persists between sessions, settings do not exist, and there is no
guidance on the controls. A player also has no "next" affordance after a stage — only
restart or quit.

## Goal

Take a new player from launch to a race in **three actions**, with stage cards that
preview **biome, length and difficulty**, a **settings** screen that **persists locally**,
**results** that offer **retry and next**, and an **optional tutorial** that teaches
accelerate, brake, handbrake and steering — each lesson **gated on the player actually
performing the action**.

## Non-goals

- Controller remapping, touch controls and full WCAG AA audit — **#APEX-12** (this
  ticket ships an accessible, keyboard-operable baseline: focus management, labels,
  non-colour-only signalling, reduced-motion, screen-reader live region).
- In-world gate detection (#APEX-16) / vehicle↔scene integration (#APEX-17); the race
  still uses the keyboard harness from #APEX-10.
- Authoring new stage content; the menu projects `StageLibrary.list()`.

## Architecture (epic binding)

Canvas-independent DOM overlay driven by **pure view models** (epic principle 2). The
menu never owns race state: it calls into `StageSession` / `StageSceneHandle`, and the
settings store is the single source of local preferences. All formatting (stage cards,
difficulty labels, tutorial gating, settings clamping) lives in DOM-free modules so it
is unit-testable under vitest's `environment: "node"`.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/stage/library.ts` | Add `lengthM` to `StageCatalogEntry` (sampled arc length) so cards can preview length. |
| `src/stage/race-adapter.ts` | Add `toStageDefinition(circuit, lengthM)` — the selected circuit becomes the race definition (gates, reference pace, opponents). |
| `src/race/session.ts` | Add `StageSession.startWith(stage)` so the menu can start/advance any stage. |
| `src/ui/settings.ts` | **Removed in favour of the shared store.** #APEX-12's `src/input/settings.ts` is the ONE settings module for the epic; this ticket adds a `game` section (`volume`, `voice`, `tutorialSeen`) to `GameSettings` and consumes `SettingsStore`. |
| `src/ui/menu-model.ts` | **New.** DOM-free view models: `homeMenu`, `stageCards(entries)`, `settingsView(settings)`, `difficultyLabel`. |
| `src/ui/tutorial.ts` | **New.** `TutorialModel`: ordered lessons with gating on an observed `VehicleInput`; `progress`, `isComplete`, `srText`. |
| `src/ui/menu.ts` | **New.** Mounts the home / stage-select / settings screens; owns the 3-action flow and focus; calls back `onRace(stageId)`, `onSettingsChange`, `onTutorial`. |
| `src/ui/tutorialOverlay.ts` | **New.** Thin DOM projection of `TutorialModel` over the canvas while a tutorial runs. |
| `src/race/hud.ts` | Results: add a **Next stage** button + `onNextStage` handler; allow the built-in select panel to be suppressed when the menu owns selection. |
| `src/race/index.ts` | Thread `onNextStage` and `stageSelect` through `RaceBootOptions`/`RaceHudHandlers`. |
| `src/main.ts` | Boot to the **home menu** (not the HUD select panel); wire stage cards → `scene.load`, three-action start, settings persistence, tutorial toggle. |
| `index.html` | Add the `#menu` host element. |

### Interfaces

```ts
// #APEX-12 owns the single settings module; #APEX-11 consumes it and extends
// GameSettings with the game preferences the menus surface.
interface GamePreferences { volume: number; voice: boolean; tutorialSeen: boolean }
interface GameSettings { version: number; input: InputSettings; accessibility: AccessibilitySettings; game: GamePreferences }
interface SettingsStore { load(): GameSettings; save(s: GameSettings): void; readonly persistent: boolean }

type MenuScreen = "home" | "stage_select" | "settings";
interface StageCardView {
  id: string; name: string; biome: string;
  lengthText: string;          // "2.4 km"
  difficulty: number;          // 1..5
  difficultyText: string;      // "★★★☆☆ Hard"
  difficultyGlyph: string;     // "★★★☆☆" (never colour-only)
}

interface TutorialLesson {
  id: "accelerate" | "brake" | "handbrake" | "steer";
  title: string; instruction: string;
  isSatisfied(input: VehicleInput): boolean;
}
class TutorialModel {
  readonly lessons: readonly TutorialLesson[];
  get index(): number; get complete(): boolean;
  observe(input: VehicleInput): boolean;  // true when a lesson just advanced
  reset(): void;
}
```

### Invariants

1. **No `innerHTML` with dynamic data** — text via `textContent`; stage/biome values are
   interpolated only through `textContent`.
2. **Three actions exactly:** `home` → *Play* (1) → *select card* (2) → *Race* (3).
   No hidden steps; the stage-select "Race" button is enabled only after a card is chosen.
3. **Settings are clamped and versioned:** unknown/malformed storage falls back to
   defaults; `volume` is clamped to `[0,1]`; a Settings write is a full replace.
4. **Tutorial gating is sequential and observable:** lesson *n+1* is active only after
   *n* is satisfied; steering counts only while the car is moving (throttle/brake not
   required), so the lesson cannot be "passed" on the grid line.
5. **Non-colour-only signalling:** difficulty is a glyph **and** a word; focus is a
   visible outline; the screen-reader live region announces screen/lesson changes.
6. **Reduced-motion:** when `reducedMotion` is set (or `prefers-reduced-motion`), menu
   transitions and the results flash are disabled.
7. **One owner of `src/main.ts`** — #APEX-12 rebases onto this branch (lead note on
   #APEX-11); this ticket owns the boot wiring.

### Edge cases

- `localStorage` unavailable / throws (private mode, quota) → in-memory defaults; the
  app still runs.
- Corrupt JSON or a value of the wrong type → defaults for that field.
- Single-stage library: "Next stage" wraps to the same stage.
- An invalidated run: results still offer Retry and Next.
- Returning to the menu after a race resets the menu to `home` and clears per-resource
  UI state (no stale card selection) — lesson **L2**.

## Acceptance criteria (Given/When/Then)

- **AC1 — three actions to a race.** Given a fresh profile on the home screen, When the
  player chooses *Play*, selects a stage card and chooses *Race*, Then the countdown
  starts — exactly three actions, with no other required interaction.
- **AC2 — stage cards preview the stage.** Given the stage library, When the stage
  select is shown, Then each card names the stage and shows its **biome**, **length**
  (formatted in metres or kilometres from the sampled centreline) and **difficulty**
  (glyph + word, 1–5).
- **AC3 — settings persist locally.** Given the settings screen, When the player changes
  volume/voice/reduced-motion and reloads, Then the new values are restored; a corrupt
  or missing store falls back to defaults without throwing.
- **AC4 — results offer retry and next.** Given a finished or invalidated run, Then the
  results panel shows **Retry** (restart the same stage) and **Next stage** (load the
  next stage in library order and start it), alongside the existing quit affordance.
  The run's gates, reference pace and opponents follow the selected/next stage
  (`toStageDefinition`), so the race a player starts matches the card they chose.
- **AC5 — optional tutorial, gated per lesson.** Given the tutorial is started, Then it
  presents lessons in order (accelerate → brake → handbrake → steering) and the current
  lesson advances **only** when the player performs its action; the runner reports
  completion and can be skipped at any time.

## How to test

- **Unit (Vitest, headless):**
  - `tests/settings.test.ts` — defaults, round-trip, clamping, corrupt JSON, throwing
    storage.
  - `tests/menu-model.test.ts` — `stageCards` length/difficulty text from entries,
    `difficultyLabel`, home/settings content, three-action contract constants.
  - `tests/tutorial-model.test.ts` — sequential gating, no-skip-ahead, steer-while-moving,
    reset, completion.
  - `tests/stage-library.test.ts` (extend existing) — `lengthM` present and ordered.
  - `tests/boot-wiring.test.ts` — pins the menu/three-action/settings wiring by name.
- **Browser evidence:** `bun run build && bun scripts/screenshot-menu.mjs` — drives the
  home → stage select → race flow, asserts three actions, card previews, settings
  persistence across reload, results Retry/Next, and the tutorial gating; captures
  `docs/evidence/APEX-11-*.png`.
- **Gates:** `bun run typecheck` and `bun run test` green; typecheck/test/build evidence
  attached.

## Evidence plan

- `docs/evidence/APEX-11-tests.txt`, `APEX-11-typecheck.txt`, `APEX-11-build.txt`.
- `docs/evidence/APEX-11-menu.txt` + `APEX-11-home.png`, `APEX-11-stage-select.png`,
  `APEX-11-settings.png`, `APEX-11-tutorial.png` (browser flow assertions).
- `docs/evidence/APEX-11-review.md`, `APEX-11-security.md`, `APEX-11-qa.md`.
