# APEX-18 — Co-driver pace notes from stage corner data

Epic: `2026-Q4-APEX-RALLY-APEX-06` — Audio & Co-driver
(architecture: `docs/architecture/2026-Q4-APEX-RALLY-APEX-06.md`).
Consumes: **#APEX-4** (`SampledSpline` arc-length centreline + sampled tangents)
and the **#APEX-10** HUD overlay. Parallel sibling: **#APEX-17** (dynamic audio
mix) — neither imports the other.

## Problem

A rally stage is raced against the clock with a co-driver calling the corners.
Without pace notes the game reads as a circuit racer: the player has the corner
geometry in the stage file (`spline` control points, sampled to an arc-length
centreline) but nothing turns it into calls. There is no list of corners, no
distance/direction/severity, no scheduling ahead of the car, and no optional voice
to read them.

## Goal

Derive co-driver pace notes from the stage format (distance, direction, severity),
surface the upcoming notes on the HUD **ahead of the car**, and optionally voice the
next note with speech synthesis. Note **density** and **lead distance** are
adjustable at runtime. A stage with no note data degrades gracefully to no notes.

## Non-goals

- **The audio mix** (engine note / tyre scrub / surface bed) — #APEX-17. This ticket
  emits note *text* only; it neither imports nor drives the mix.
- **In-world gate detection / a real car on the stage** — a later integration ticket
  (#APEX-16 / physics wiring). Arc-distance is projected from whatever car position
  the composition root supplies; today that is the keyboard harness, as #APEX-3 did
  for gate crossings.
- **Crests, jumps, "don't cut", splits and other rally annotations** — the stage
  format carries heading change only. Only distance/direction/severity are notes.
- **A voice-model choice or custom audio assets** — the browser's
  `speechSynthesis` is used behind a port; no recording, no TTS service.
- **A settings screen** — density/lead/voice are adjustable through the tracker API
  and the HUD's voice toggle, not a persisted options menu.

## Architecture (epic binding)

The epic requires "co-driver pace notes derived from stage data, inside the frame
budget". This ticket implements that as a **pure, headless** pipeline layered on the
#APEX-4 sampled centreline: notes are derived once at load from curvature, and a
scheduler advances cursors by car arc-distance with no per-frame work proportional
to the stage. Platform speech lives behind a one-method port.

```
StageCircuit.spline ──sampleSpline──▶ SampledSpline ──windowed heading──▶ Corner[]
                                            │                              │
                                            └──────────────┐               ▼
   samples (arc length) ──────────────────────────────────▶ buildPaceNotes ──▶ PaceNote[]
                                                                                  │
        car position ──nearestDistanceOnSpline──▶ distance ──▶ PaceNoteTracker ◀──┘
                                                    │   (leadDistance, density)
                                                    ▼
                                 view(): { current, upcoming, next, nextText }
                                                    │
                              ┌─────────────────────┴──────────────────────┐
                              ▼                                             ▼
                    buildPaceNoteHud ──▶ RaceHud panel            Voice port (speechSynthesis)
```

The module imports **only** `src/stage/spline` (and stage types) — no `three.js`, no
DOM — so the whole pipeline runs in Vitest with no GPU and no browser.

### Modules (`src/race/`)

| Module | Responsibility |
| --- | --- |
| `pace-notes.ts` | `buildPaceNotes(spline, opts)`, `severityForAngle`, `noteCall`, `nearestDistanceOnSpline`, `PaceNoteTracker`, and the `PaceNote` / `PaceNoteView` types. Pure and deterministic. |
| `voice.ts` | `createSpeechVoice(source, opts)` — a `Voice` port over `speechSynthesis`; returns an unavailable no-op voice when the platform (or a test) supplies nothing. |
| `hud-model.ts` | `buildPaceNoteHud(view)` — pure string projection (`nextCall`, `nextDistance`, `following[]`, `visible`) the overlay paints. |
| `hud.ts` | The pace-note panel (bottom-left) + a polite live region for the current call + the optional voice toggle. |
| `index.ts` | Barrel: re-export the pace-note + voice API. |

### Note derivation

- A shipped rally stage is a smooth Catmull-Rom curve: heading changes only a few
  degrees between adjacent cross-sections. Corners are therefore found from the
  **windowed** heading change of the sampled tangents — the net heading change over
  a ±`windowMetres` (~16 m) arc — not from single-sample deltas. Runs of same-sign
  windows above `thresholdDeg` are grouped into one corner; the corner's angle is the
  single net heading change across its full span (so a smooth bend is not
  double-counted). The apex is the sample with the largest windowed change.
- **Severity** maps |angle| to the rally scale 1..6 (`1` flat-out kink → `6`
  hairpin): `≥150°→6`, `≥100°→5`, `≥70°→4`, `≥45°→3`, `≥25°→2`, else `1`.
- `call` is `"Hairpin left"` / `"Hairpin right"` at ≥130°, otherwise `"Left n"` /
  `"Right n"`. `label` is the nearest checkpoint name within a tolerance, else `null`.
- Notes are ordered by arc `distance`; `gap` is the distance from the previous note
  (or the stage start). `minSpacing` merges notes closer together than a threshold,
  keeping the more severe of the pair.

### Scheduler

`PaceNoteTracker.update(distance)` (via `setDistance`) maintains three cursors over
the note list: `current` (last note at/before the car), `upcoming` (notes within
`leadDistance` ahead, nearest first) and `next` (the first of those). Because the
list is distance-ordered, advancing is a bounded scan from the cursor — O(notes in
the window), not O(stage). `pollAnnouncement()` returns a note exactly once, the
frame it enters the lead window, so the voice speaks each call once. Announcements
are keyed by the note's stable `distance`, not by its position in the filtered
list, so a runtime `setDensity`/`setLeadDistance` change never re-calls a note that
was already voiced and never skips a note the filter has just revealed (#APEX-33).

- `setLeadDistance(metres)` changes how far ahead notes are surfaced/called.
- `setDensity(01)` filters how many corners survive: `0` keeps only hairpins at wide
  spacing, `1` keeps every corner at tight spacing.

### Graceful degradation

A degenerate spline (`count < 2`, zero length) yields `[]` from `buildPaceNotes`.
A tracker over `[]` reports `hasNotes === false`, `next === null`, `nextText === "No
notes"`; the HUD hides the panel and the voice never speaks. A stage with corners but
no notes within the lead window likewise shows a clean (empty) panel.

### Interfaces

```ts
type NoteDirection = "left" | "right";

interface PaceNote {
  index: number; distance: number; t: number;
  direction: NoteDirection; severity: number; angleDeg: number;
  label: string | null; call: string; gap: number;
}

interface PaceNoteOptions { thresholdDeg?: number; windowMetres?: number; minSpacing?: number; labelTolerance?: number; }
interface PaceNoteTrackerOptions { leadDistance?: number; density?: number; }

interface PaceNoteView {
  hasNotes: boolean; current: PaceNote | null; upcoming: PaceNote[];
  next: PaceNote | null; nextText: string;
}

function buildPaceNotes(spline: SampledSpline, opts?: PaceNoteOptions): PaceNote[];
function severityForAngle(angleDeg: number): number;
function noteCall(direction: NoteDirection, angleDeg: number, severity: number): string;
function nearestDistanceOnSpline(spline: SampledSpline, x: number, z: number): number;

class PaceNoteTracker {
  constructor(notes: PaceNote[], opts?: PaceNoteTrackerOptions);
  get notes(): readonly PaceNote[];
  setLeadDistance(metres: number): void;
  setDensity(density01: number): void;
  setDistance(metres: number): void;
  view(): PaceNoteView;
  pollAnnouncement(): PaceNote | null;
  reset(): void;
}

type Voice = { readonly available: boolean; speak(text: string): void; cancel(): void };
function createSpeechVoice(source?: SpeechSynthesisLike | null, opts?: VoiceOptions): Voice;
```

### Invariants

1. `buildPaceNotes` is pure: identical `(spline, opts)` ⇒ deeply equal notes. No
   `Math.random`, no `Date.now`.
2. Notes are strictly increasing in `distance`; `gap ≥ 0` and `direction` matches the
   sign of `angleDeg`.
3. `severity ∈ [1,6]`; `call` is non-empty for every note.
4. `PaceNoteTracker` is O(notes in the lead window) per `setDistance`; it never
   mutates the note list.
5. `nearestDistanceOnSpline` is finite and within `[0, length]` for any input point.
6. `createSpeechVoice(null)` never throws and reports `available === false`; its
   `speak` is a no-op.

### Edge cases

- Degenerate spline / no corners ⇒ no notes (`hasNotes === false`).
- Two corners closer than `minSpacing` ⇒ merged; the more severe survives.
- Car distance beyond the last note ⇒ `next === null`, `current` is the last corner.
- Density/lead changed at runtime after an announcement ⇒ re-filtered visible list;
  `pollAnnouncement` stays idempotent (no duplicate call, no skipped nearer note).
- Negative / non-finite distance or options ⇒ clamped to sane defaults, never throws.
- `speechSynthesis` present but `SpeechSynthesisUtterance` absent ⇒ still no-op safe.

## Acceptance criteria (Given/When/Then)

- **AC1 Notes derived from corner data** — Given a stage whose spline has a bend,
  When `buildPaceNotes` runs, Then a note is produced carrying its `distance`
  (metres from start) and `direction` (left/right), with severity 1..6.
- **AC2 Notes advance with car progress** — Given a tracker over a stage's notes,
  When the car arc-distance increases past a corner, Then `next` becomes the
  following corner and `upcoming` holds only notes within the lead distance.
- **AC3 Optional synthesised voice reads the next note** — Given a voice source and a
  tracker, When a note enters the lead window, Then `pollAnnouncement()` yields that
  note once and `Voice.speak(note.call)` is called; with no source, voice is
  unavailable and the game is unaffected.
- **AC4 Density and lead distance are adjustable** — Given the same notes, When
  `setDensity` is raised, Then at least as many notes are surfaced; When
  `setLeadDistance` is raised, Then `upcoming` covers at least as many notes.
- **AC5 Degrade gracefully with no note data** — Given a spline with no detectable
  corners, When notes/tracker run, Then `hasNotes === false`, `nextText === "No
  notes"`, the voice never speaks and the HUD panel is hidden.

## How to test

- `bun run test` — `tests/pace-notes.test.ts` and `tests/voice.test.ts` (note
  derivation, severity/call, scheduler advance, density/lead, degradation,
  projection, voice port with a fake `speechSynthesis`).
- `bun run typecheck` — clean.
- `bun run build` — production bundle succeeds.
- Manual: `bun run dev`; start a stage, drive at pace and watch the bottom-left
  panel call the next corner ahead of the car; press the voice toggle and hear the
  next note; reload a stage with no corners and confirm the panel stays hidden.

## Evidence

- `docs/evidence/APEX-18-tests.txt` — Vitest green incl. the new suites.
- `docs/evidence/APEX-18-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-18-build.txt` — `vite build` succeeds.
- `docs/evidence/APEX-18-review.md` — code review notes.
- `docs/evidence/APEX-18-security.md` / `-security-audit.txt` — security review.
- `docs/evidence/APEX-18-qa.md` — acceptance walkthrough against AC1–AC5.
