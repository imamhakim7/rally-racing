# APEX-11 — Code review evidence

Gate: `in_development -> code_review`. Reviewer: independent agent pass (read-only).

**Verdict: APPROVE** (after one CHANGES_REQUESTED round).

## Round 1 findings and resolution

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | high | Browser tutorial evidence flaky (fixed sleeps vs. engine frames) | `scripts/screenshot-menu.mjs` now polls `window.apexStage.tutorial.index` via `waitForFunction`; 10/10 deterministic runs |
| 2 | med | `tutorialSeen` was write-only | Home shows a first-run callout gated on `tutorialSeen`; hidden once seen; pushed via `menu.setSettings` |
| 3 | med | Next stage only swapped the visual circuit; race stayed on the demo stage | Added `toStageDefinition(circuit, lengthM)` + `StageSession.startWith`; the selected/next stage drives gates, reference pace and opponents |
| 4 | low | `StageCardView.difficulty` not clamped | `clampDifficulty` used by both the view and the label; test added |
| 5 | low | Settings volume coerced wrong types | `clampSettings` requires `typeof === "number"` |
| 6 | low | Tutorial overlay focus / dispose on completion | `focus()` on the skip control; completion closure delayed 1200 ms so the complete state paints |
| 7 | low | Missing `nextStageId` wrap test | Added to `tests/menu-model.test.ts`; `toStageDefinition` covered in `tests/stage-loader.test.ts` |

## Round 2 (post-fix) independent re-review

**Verdict: APPROVE.** All seven findings confirmed fixed. Two non-blocking latent items
were then addressed in the same branch: `StageSession.stage` is updated by `startWith`
(was stale), and a dead conditional was removed from the evidence script.

## Gates

```
$ bun run typecheck            # tsc --noEmit, exit 0
$ bun run test                 # Test Files 49 passed (49) / Tests 336 passed (336)
$ bun run build                # 62 modules transformed, built (chunk-size warning only)
$ node scripts/screenshot-menu.mjs   # APEX-11 menu evidence: OK (5/5 runs)
$ bun run smoke:browsers       # all ok:true
```

Full outputs: `docs/evidence/APEX-11-typecheck.txt`, `APEX-11-tests.txt`,
`APEX-11-build.txt`, `APEX-11-menu.txt`, `APEX-11-smoke.txt`.

## Integration with #APEX-12 (rebased onto origin/main `d48abf4`)

#APEX-12 (input abstraction + a11y) merged before this branch, and the epic architecture
binds `src/input/settings.ts` as the ONE settings module. On rebase:

- Deleted the parallel `src/ui/settings.ts`/`tests/settings.test.ts`; extended
  `GameSettings` with a `game` section (`volume`, `voice`, `tutorialSeen`) and consumed
  #APEX-12's `SettingsStore`.
- Merged `src/main.ts` so both boot paths coexist: #APEX-12's input manager feeds the
  telemetry harness (`createTelemetryHarness({ input: () => input.read() })`), the
  settings panel and the menu both write the one store via a shared `onSettingsChange`.
- Menu reduced-motion is the shared `auto|on|off` preference; the `index.html` HUD-motion
  rule now keys off #APEX-12's `html[data-motion="reduced"]`.
- Fixed `scripts/check-a11y.mjs` to target `.apex-settings__toggle` (the menu added a
  second "Settings" button); the #APEX-12 a11y gate passes (`check-a11y.mjs` exit 0).

