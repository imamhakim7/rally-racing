# APEX-11 — QA verification evidence

Gate: `to_qa -> qa_testing`. QA: independent agent pass (read-only; commands run).

**Verdict: PASS** (after one FAIL round on flaky AC5 evidence).

## Acceptance criteria

| AC | Requirement | Evidence | Result |
| --- | --- | --- | --- |
| AC1 | Three actions home → race | home → `Play` → stage card → `Race`; `phase:"countdown"`, `menuHidden:true` | PASS |
| AC2 | Cards preview biome/length/difficulty | 6 cards; sample `biome:"forest"`, `lengthM:476.61`, `meta:"forest · 477 m"`, `difficulty:"★★★☆☆ Medium"`; per-card assertions | PASS |
| AC3 | Settings persist locally | change → reload → re-read `{volume:0.25, voice:false, reducedMotion:true}`; `data-reduced-motion` applied | PASS |
| AC4 | Results Retry + Next; definition follows | buttons `["Restart","Next stage","Quit to stage select"]`; `next-stage alpine-forest→canyon-sprint`, `raceStageId:"canyon-sprint"`; invalidated run still offers both | PASS |
| AC5 | Tutorial gated per lesson + optional skip | negative gate `indexAfterBrake:0`; ordered completion `{index:4, complete:true, tutorialSeen:true}`; first-run callout hidden; `tutorial-skip {overlayHidden:true, menuVisible:true}` | PASS |

## Determinism

- Round 1: browser AC5 gate failed 3/10 reruns (fixed sleeps vs. engine frames).
- Round 2 (after polling rewrite): **10/10 runs OK**; `docs/evidence/APEX-11-menu.txt`
  (`verdict: OK`) and `APEX-11-menu.json` (`"ok": true`, `"problems": []`) are written by
  the script itself and match.

## Commands

```
$ bun run typecheck          # exit 0
$ bun run test               # 49 files / 336 tests passed
$ bun run build              # exit 0
$ node scripts/screenshot-menu.mjs   # 5/5 OK (round 2)
$ bun run smoke:browsers     # wiring ok: menu:true, stageCards:6
```

## Gaps / notes

- AC3's corrupt/missing-store fallback is covered by #APEX-12's
  `tests/input-settings.test.ts` (`normalizeSettings`) plus this ticket's browser reload
  flow; the browser flow covers reload persistence.
- Race gate detection remains the keyboard harness (deferred to #APEX-16); the run's
  *definition* now follows the selected stage, but crossings are still simulated.
- Rebased onto #APEX-12 (origin/main `d48abf4`): settings persist through the shared
  `src/input/settings.ts` store; the menu consumes it (no parallel store).

Artifacts: `APEX-11-tests.txt`, `APEX-11-typecheck.txt`, `APEX-11-build.txt`,
`APEX-11-menu.json`, `APEX-11-menu.txt`, `APEX-11-smoke.txt`, `APEX-11-*.png`.
