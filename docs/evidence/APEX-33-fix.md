# APEX-33 — fix evidence (unblocks #APEX-18)

QA gate failure on #APEX-18: `PaceNoteTracker.pollAnnouncement()` was not
idempotent across `setDensity()`. After a runtime density change re-indexes the
filtered `visible` list, a note already voiced was returned again (duplicate
co-driver call) and a note the filter had hidden at announcement time was skipped
once density revealed it (missed call).

## Root cause

`PaceNoteTracker` tracked announcements with a positional cursor
`announcedThrough` into the *filtered* `visible` array, and `rebuildVisible()`
patched it with `Math.min(announcedThrough, visible.length)`. Positions are not
stable when the filter changes membership, so the cursor pointed at the wrong
note.

## Fix

Track announcements by the note's stable identity — its arc `distance` — in a
`Set<number>`, instead of by position:

- `pollAnnouncement()` skips any note already in `announced` and adds the note it
  returns.
- `rebuildVisible()` no longer re-derives announcement state (identity survives
  re-filtering); `reset()` clears the set.

Files changed:

- `src/race/pace-notes.ts` — `PaceNoteTracker.announced` set; `pollAnnouncement`,
  `reset`, `rebuildVisible`.
- `tests/pace-notes.test.ts` — regression test
  "stays idempotent when density changes at runtime (APEX-33 regression)".
- `docs/openspecs/APEX-18.md` — Scheduler invariant + edge case documented.

## Verification

- `docs/evidence/APEX-33-repro.txt` — standalone repro (pre-fix duplicate/skip,
  post-fix clean); `announce#2` is `null` (no duplicate) and the lowered-density
  hairpin is still called (no skip).
- `docs/evidence/APEX-33-tests.txt` — `bun run test`: **269 passed (40 files)**,
  including the new regression test (fails against the old positional cursor).
- `docs/evidence/APEX-33-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-33-build.txt` — `vite build` succeeds.

## Invariant (regression guard)

Given a tracker that has already announced a note, when `setDensity()` (or
`setLeadDistance()`) re-indexes the visible notes, then `pollAnnouncement()` never
repeats an already-called note and never skips a newly-visible nearer note.
