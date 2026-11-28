# Epic architecture — `2026-Q4-APEX-RALLY-APEX-06` Audio & Co-driver

Binding design for every ticket under this epic. If a ticket needs to diverge, it
updates this document first, then the code (SDD rule: spec → change → test → validate).

## Goal

Rally feel is audio-led and co-driver-led. The engine note, tyre scrub and the
call of the next corner carry speed, grip and pace to the player. This epic adds a
**dynamic audio mix** driven by car/environment state (#APEX-17) and **co-driver
pace notes** derived from the stage's corner geometry (#APEX-18), both inside the
frame budget.

## Principles

1. **Data-derived, never hand-authored.** Rally content already lives in the stage
   file (`spline`, `checkpoints`, `surfaces`). Audio and notes are *computed* from
   that data at load (curvature → notes; rpm/slip/surface → mix). A stage with no
   usable data degrades to silence / no notes rather than failing.
2. **Pure core, port at the edge.** The decision logic (note derivation, the
   scheduler, phrase formatting, mix gains) is plain, deterministic, headless
   TypeScript with no DOM, no Web Audio and no `three.js`. Platform APIs
   (`speechSynthesis`, `AudioContext`) sit behind narrow **ports** so the core is
   unit-tested in Vitest (`environment: "node"`) and is testable with fakes.
3. **Ports accept injected sources.** Consumers do not reach for globals. A port is
   constructed with a structural interface (e.g. a `SpeechSynthesisLike`) so tests
   pass a fake and the browser passes `window`.
4. **Frame budget is a first-class constraint.** Per-frame work is O(notes in the
   lead window) / O(active voices), not O(stage). Notes are computed once at load;
   the scheduler only advances cursors by car distance. No per-frame allocation in
   the hot path beyond bounded buffers.
5. **Accessibility and resilience.** Everything the co-driver voices is also
   surfaced visually (the HUD panel) and announced to assistive tech through a
   polite live region; voice output is optional and off if the platform lacks it.
   The car can always be driven with the audio/voice entirely disabled.

## System shape

```
stage file ──validate──▶ StageCircuit ──sampleSpline──▶ SampledSpline
                                   │                          │
                                   │                    detectCorners
                                   │                          ▼
                                   │                    buildPaceNotes ──▶ PaceNote[]
                                   │                                        │
                    car state ──▶ PaceNoteTracker ◀── leadDistance, density ─┘
                                   │  view(): { current, upcoming, next, nextText }
                                   ▼
                         src/race/hud-model.ts  (pure projection)
                                   │
                  ┌────────────────┴─────────────────┐
                  ▼                                  ▼
        src/race/hud.ts (DOM/SVG panel)      Voice port (speechSynthesis)

  #APEX-17 (parallel):  car/env state ──▶ AudioMixModel (gains) ──▶ AudioPort (Web Audio)
```

`src/stage/spline.ts` already exposes the arc-length `SampledSpline` and
`detectCorners`; this epic builds on that contract rather than re-deriving geometry.
Because shipped stages are smooth, `buildPaceNotes` measures the *windowed* heading
change of the sampled tangents (≈16 m) to find corners rather than relying on
single-sample heading deltas.

## Interfaces owned by this epic

```ts
// #APEX-18 — src/race/pace-notes.ts
type NoteDirection = "left" | "right";
interface PaceNote {
  index: number;              // stage order
  distance: number;           // metres from stage start to the corner
  t: number;                  // arc-length fraction in [0,1]
  direction: NoteDirection;
  severity: number;           // 1 (flat-out) .. 6 (hairpin)
  angleDeg: number;           // signed heading change (+ right)
  label: string | null;       // nearest checkpoint name, if any
  call: string;               // co-driver phrase, e.g. "Right 3"
  gap: number;                // metres from the previous note
}
interface PaceNoteView {
  hasNotes: boolean;
  current: PaceNote | null;   // corner most recently reached
  upcoming: PaceNote[];       // ordered, within the lead distance
  next: PaceNote | null;      // next note to call
  nextText: string;           // HUD/voice text, e.g. "Right 3 · 240 m"
}
class PaceNoteTracker {
  constructor(notes: PaceNote[], opts?: PaceNoteTrackerOptions);
  setLeadDistance(metres: number): void;
  setDensity(density01: number): void;   // 0 sparse .. 1 dense
  setDistance(metres: number): void;     // advance by car arc-distance
  view(): PaceNoteView;
  pollAnnouncement(): PaceNote | null;   // once per newly-entered note (voice)
  reset(): void;
}

// #APEX-18 — src/race/voice.ts
interface Voice { readonly available: boolean; speak(text: string): void; cancel(): void; }
function createSpeechVoice(source?: SpeechSynthesisLike | null, opts?: VoiceOptions): Voice;

// #APEX-17 — src/audio/ (mix model + Web Audio port; see that ticket's openspec)
```

## Cross-ticket contracts

- **#APEX-17 ⇄ #APEX-18:** both read the same `StageCircuit`/`SampledSpline` and the
  same car state. Neither imports the other. The composition root (`src/main.ts`)
  owns the ports and the frame wiring; audio owns its own gains, notes own their
  own schedule. The shared interface is "car state in, data-derived output out".
- **#APEX-18 ⇄ HUD (#APEX-10):** the note panel is a *view* of `PaceNoteView`; the
  HUD never computes notes. `src/race/hud-model.ts` holds the pure string
  projection so it is asserted headlessly.
- **#APEX-18 ⇄ physics/ai:** the car's arc-distance is obtained by projecting its
  world position onto the spline (`nearestDistanceOnSpline`); while the in-world
  car is still a harness this uses the harness position, and becomes a one-line
  swap once real telemetry lands.

## Invariants (epic-wide)

1. **Determinism / purity.** Note derivation and the scheduler are pure functions of
   their inputs; identical stage + distance ⇒ identical notes and view. No
   `Math.random`, no `Date.now`.
2. **Load-time cost only.** `buildPaceNotes` runs once per stage load; the per-frame
   scheduler is O(notes in window). No allocation proportional to stage length per
   frame.
3. **Graceful degradation.** Missing/degenerate stage data ⇒ empty notes and a
   silent mix; the absence is represented explicitly (`hasNotes === false`), never
   an exception.
4. **No DOM/Web Audio in the core.** `src/race/pace-notes.ts` and the audio mix
   model import only other pure modules; platform access is behind ports.
5. **Voice is optional.** If `speechSynthesis` is unavailable, or the player turns
   voice off, the game is fully playable and the visual notes still work.

## Acceptance criteria (epic-level)

- **AC1 Speed & grip are audible** — engine note and tyre scrub track car state;
  surface changes change the mix (#APEX-17).
- **AC2 The co-driver calls the road** — pace notes are derived from stage corner
  data and advance with the car, ahead of the corner (#APEX-18).
- **AC3 Optional voice** — the next note can be read by a synthesised voice and can
  be disabled (#APEX-18).
- **AC4 Tunable** — note density and lead distance, and the audio mix balance, are
  adjustable without a code change (#APEX-17/#APEX-18).
- **AC5 In budget & resilient** — the epic adds no unbounded per-frame work, and a
  stage/device with no audio or note capability degrades cleanly.

## How to test (epic-level)

- `bun run test` — pure unit suites for the note builder + scheduler and the mix
  model, with fake ports (no browser/GPU).
- `bun run typecheck` / `bun run build` — clean.
- Manual: drive a stage at pace; hear the mix follow the surface and the co-driver
  call the corners ahead of the car; toggle voice and confirm the HUD still works.
