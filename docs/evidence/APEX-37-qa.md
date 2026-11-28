# APEX-37 — QA verification

Verdict: **pass** (with one non-blocking cosmetic observation). Independently verified
by the QA seat on a real built `dist/` in headless Chromium (SwiftShader), not by
re-running the dev's script.

Ticket: `#APEX-37` — HUD speed/time/pace-note readouts ignore the 200% text-size
setting (`#APEX-12` AC5). Fix under test: `fix(hud): scale prominent readouts with
text-size setting` (dev commit `802a56e`, cherry-picked onto this branch as `924cf22`).

**Re-run (PR #24, branch tip `0424f6e`).** After the QA pass, merged `main` gained
`#APEX-11` menus/stage-select/settings (`0c08e86`), which changed the menu, settings
surface and race-start flow. This branch was re-cut on top of that and QA re-ran the
full verification against a fresh build of `0424f6e`; all checks below still pass
(50 files / 338 tests). The menu's own headings (`.apex-menu h1/h2`) use absolute
`clamp()` and do not scale, but they are outside this ticket's HUD-readout scope —
noted for the epic, see Observations.

## Acceptance → evidence

| AC (orchestrator) | Check | Result |
| --- | --- | --- |
| `.apex-countdown` scales with `var(--apex-text-scale)` | live computed font at 100/150/200% | pass |
| `.apex-live .apex-time` scales | live computed font at 100/150/200% | pass |
| `.apex-speed .apex-speed-value` scales | live computed font at 100/150/200% | pass |
| `.apex-notes .apex-notes-call` scales | live computed font at 100/150/200% | pass |
| scales **up to 200%** (not just 100→200) | 150% target measured as well | pass |
| readouts stay unclipped at 200% on desktop + mobile | box + truncation probe at 1280×800 and 390×844 | pass |
| regression test added | `tests/hud-text-scale.test.ts` | pass |

## How it was verified (independent)

`scripts/qa-apex37-independent.mjs` (QA-authored, separate from the dev's
`scripts/qa-apex37-verify.mjs`) serves the built `dist/`, drives the **real**
`#APEX-12` Settings panel (floating `Settings` toggle → text-size range → `Close`),
starts the stage through the **`#APEX-11` menu** (`Play` → stage card → `Race`),
waits for the countdown phase to read `.apex-countdown`, drives with `W`, then reads
`getComputedStyle().fontSize` for the four readouts at 100/150/200% on both
viewports.

### Fixed build (re-run, branch tip `0424f6e`)

`docs/evidence/APEX-37-qa-independent.txt` — **PASS**, exit 0.

```
desktop scale_2: applied=2 root=2 countdown=2 time=2 speed=2 notes=2 clipped=0
mobile  scale_2: applied=2 root=2 countdown=2 time=2 speed=2 notes=2 clipped=0
desktop scale_1.5: applied=1.5 root=1.5 countdown=1.5 time=1.5 speed=1.5 notes=1.5
mobile  scale_1.5: applied=1.5 root=1.5 countdown=1.5 time=1.5 speed=1.5 notes=1.5
```

Every prominent readout ratio is exactly the applied text scale (1.5× and 2.0×), and
the root `--apex-text-scale` matches what the slider set.

### Merged baseline (pre-fix `d48abf4`) — defect reproduced

Same script against a build of merged `main` (the build the defect was filed on):
`docs/evidence/APEX-37-qa-baseline-merged-d48abf4.txt` — **FAIL**, 16 failures.

```
desktop scale_2: applied=2 root=2 countdown=1 time=1 speed=1 notes=1
mobile  scale_2: applied=2 root=2 countdown=1 time=1 speed=1 notes=1
```

i.e. the HUD root doubles but all four readouts were pinned at 1.0×, exactly as
reported. The fix moves them to 2.0×.

### Regression test guard

`tests/hud-text-scale.test.ts` fails on the baseline (2 failed) and passes on the
fixed build (2 passed): `docs/evidence/APEX-37-qa-tests.txt`.

### Clipping at 200%

`docs/evidence/APEX-37-qa-clip-200pct.json` — for all four readouts on both
viewports, `textFits=true`, no horizontal truncation (`scrollWidth == clientWidth`),
and boxes inside the viewport (`docOverX=0`, `docOverY=0`). At desktop 200% the
`.apex-live` panel's scrollHeight exceeds its 24vh clientHeight by ~2px, but the
panel is `overflow: visible`, so nothing is cut — recorded as a notice, not a clip.
Screenshots: `APEX-37-qa-desktop-200pct.png`, `APEX-37-qa-mobile-200pct.png`.

## Build / suite

- `bun run typecheck` clean (`APEX-37-qa-typecheck.txt`).
- `bun run build` succeeds (`APEX-37-qa-build.txt`).
- `bun run test` — **50 files / 338 tests passed** (`APEX-37-qa-tests.txt`).

## Observations (non-blocking)

1. **Branch placement.** The dev fix commit `802a56e` was committed to
   `feat/APEX-12-input-abstraction-and-accessibility-game`, not to this ticket's
   branch. QA cherry-picked it onto `fix/APEX-37-hud-speed-time-pace-note` (`924cf22`)
   so the fix is actually part of this ticket's PR/release. Recommend dev commits
   land on the ticket branch.
2. **Cosmetic spill.** At desktop 200% the `.apex-live` panel's translucent
   background ends ~2px above the secondary `next:` row. Text is not clipped
   (`overflow: visible`) and all four required readouts are fully inside the
   viewport, so this does not fail AC5. Low-severity polish item for the epic.
3. **Menu headings.** `#APEX-11`'s `.apex-menu h1/h2` use absolute `clamp()` sizes
   and do not multiply by `var(--apex-text-scale)`, so the menu chrome does not grow
   with the text-size setting. This ticket names HUD race readouts only, so it is
   out of scope here; flagged for the epic's WCAG-AA pass.

## Epic intent (2026-Q4-APEX-RALLY-APEX-04)

AC5 accessibility is restored: the most prominent HUD numbers now honour the user's
text-size setting to the documented 200% maximum without clipping, on desktop and
mobile — one root knob (`--apex-text-scale`) now governs all race readouts.
