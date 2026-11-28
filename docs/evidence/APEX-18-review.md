# APEX-18 — code review

Reviewer: seat-code-review (self-review of the dev branch; human review still welcome)
Scope: `src/race/pace-notes.ts`, `src/race/voice.ts`, `src/race/hud-model.ts`,
`src/race/hud.ts`, `src/race/telemetry.ts`, `src/race/index.ts`, `src/main.ts`,
`scripts/screenshot-pace-notes.mjs`, tests, docs.

## Verdict: APPROVE (changes not required for merge)

## What was checked

- **Spec-first.** `docs/openspecs/APEX-18.md` and the epic architecture
  `docs/architecture/2026-Q4-APEX-RALLY-APEX-06.md` exist and match the code
  (AC1–AC5 map to `buildPaceNotes`, `PaceNoteTracker`, `Voice`, density/lead, and
  the no-note path).
- **Purity / determinism.** `pace-notes.ts` and `voice.ts` import no DOM, no
  `three.js`, no Web Audio. No `Math.random` / `Date.now`. A unit test asserts
  `buildPaceNotes` is deep-equal across runs.
- **Separation of concerns.** Notes/scheduling are pure; the HUD only paints
  `buildPaceNoteHud` output; `speechSynthesis` is behind the `Voice` port
  (`createSpeechVoice`), constructed from a structural source so tests inject a
  fake. The composition root (`main.ts`) is the only place that touches `window`.
- **Types.** `tsc --noEmit` clean with `strict`, `noUncheckedIndexedAccess`,
  `noUnusedLocals`. No `any` introduced.
- **Per-frame cost.** Load-time note derivation is one pass over samples. The
  scheduler uses `upperBound` (binary search) + a bounded scan; `nearestDistanceOnSpline`
  is O(samples) (~150–285) per frame — trivial and allocation-free.
- **Edge cases.** Degenerate/straight spline → `[]`; non-finite distance/options
  clamped; empty speech text ignored; a throwing speech backend is swallowed.
- **Tests.** 266 pass incl. 21 new (note derivation, severity/call, ordering/gaps,
  merging, scheduler advance, lead/density, announcements, degradation, projection,
  voice port). Browser probe `scripts/screenshot-pace-notes.mjs` drives the real
  built app: panel surfaces "Right 4 · 218 m", then "Left 2", voice toggle present.

## Notes / follow-ups (non-blocking)

- `buildPaceNotes` uses its own windowed heading change (~16 m) rather than the
  #APEX-4 `detectCorners` 2-sample window, because shipped Catmull-Rom stages are
  too smooth for single-sample deltas. Documented in the openspec/architecture.
- The default stage now yields 2 notes; deciding a "good" note count for each
  shipped stage is content tuning, not this ticket.
- `window.apexStage.pace` is exposed for tooling/evidence, mirroring the existing
  `apexStage`/`apexRace` hooks.

## Evidence

- `docs/evidence/APEX-18-tests.txt`, `-typecheck.txt`, `-build.txt`,
  `-browser.txt`, `-pace-notes.png`.
