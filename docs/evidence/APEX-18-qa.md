# APEX-18 — QA acceptance walkthrough

QA: seat-qa (headless evidence + real browser probe)
Build under test: `feat/APEX-18-co-driver-pace-notes-from` at the commit referenced
below. Verify by re-running the commands in each row.

| AC | Check | How | Result |
| --- | --- | --- | --- |
| AC1 Notes from corner data (distance + direction) | `buildPaceNotes` yields notes with metres-from-start and left/right | `tests/pace-notes.test.ts` → "derivation (AC1)" | PASS |
| AC2 Notes advance with progress | Scheduler `next` moves past a corner; `upcoming` bounded by lead | `tests/pace-notes.test.ts` → "advance with progress (AC2)"; browser probe `advanced` | PASS |
| AC3 Optional synthesised voice | Fake `speechSynthesis` receives the next call once; no-op without a source; toggle present | `tests/voice.test.ts`; browser probe `voiceButton` | PASS |
| AC4 Density & lead adjustable | Raising density never reduces surfaced notes; raising lead never reduces upcoming | `tests/pace-notes.test.ts` → "density (AC4)", "limits upcoming…" | PASS |
| AC5 Degrade gracefully | Straight stage → no notes; HUD hidden; voice silent | `tests/pace-notes.test.ts` → "graceful degradation (AC5)" | PASS |

## Evidence runs

- `docs/evidence/APEX-18-tests.txt` — `bun run test`: **266 passed (40 files)**
  (21 new across `tests/pace-notes.test.ts`, `tests/voice.test.ts`).
- `docs/evidence/APEX-18-typecheck.txt` — `bun run typecheck`: clean.
- `docs/evidence/APEX-18-build.txt` — `bun run build`: production bundle succeeds.
- `docs/evidence/APEX-18-browser.txt` + `APEX-18-pace-notes.png` — headless
  Chromium on the built app (`scripts/screenshot-pace-notes.mjs`): the pace-note
  panel is visible while racing showing `Right 4 · 218 m` with `then Left 2`, the
  voice toggle is `on`, and the scheduler advances to `Left 2 · 191 m` after the
  car passes the first corner (`ok: true`, no console/page errors).

## Acceptance criteria siblings (sanity)

- N/A (this ticket has no sibling ACs; epic sibling #APEX-17 is the audio mix).

## Verdict: PASS — all of AC1–AC5 verified with attached evidence.
