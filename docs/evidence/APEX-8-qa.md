# APEX-8 — QA verification (independent, headless)

Ticket: Difficulty tiers and fair catch-up tuning.
Epic: `2026-Q4-APEX-RALLY-APEX-03` CPU Opponents & Racing Balance.
Branch: `feat/APEX-8-difficulty-tiers-and-fair-catch`.

## How verified

All checks are reproducible from the branch (no manual/human step required):

| Command | Result | Evidence |
| --- | --- | --- |
| `bun run typecheck` | clean (exit 0) | `docs/evidence/APEX-8-typecheck.txt` |
| `bunx vitest run` | 365 passed / 52 files | `docs/evidence/APEX-8-tests.txt` |
| `bun scripts/ai-difficulty-report.ts --seeds=20` | `ALL OK: true` | `APEX-8-difficulty-report.{json,txt}` |
| `bun run build` | built, exit 0 | `docs/evidence/APEX-8-build.txt` |
| `bun scripts/screenshot-difficulty.mjs` | `ok: true`, 4 cars, no page errors | `APEX-8-screenshot.txt`, `APEX-8-race-easy.png`, `APEX-8-race-rally-legend.png` |
| `bun scripts/playtest-difficulty.mjs` | `ALL OK: true` (8 races) | `APEX-8-playtest.{json,txt}` + filmstrip |
| `bun scripts/headless-race.ts` ×2 (cross-process) | identical, `VERDICT: PASS` | integration with #APEX-9 determinism gate |

Re-verified after rebasing onto `origin/main` @ `15a258f` (which merged #APEX-9). The
integrated tree passes both gates; the default (no-tier) race stays bit-identical in
finish times/order/separation to the #APEX-9 baseline (only replay-frame `progress`
is now post-step, so CI regenerates the #APEX-9 trace hashes).

Report head (20 seeds × 6 stages × 4 tiers = 480 races/tier):

```
PASS easy          refWin=1    corner=13.04 straight=18.29 maxΔv=15.14 maxStep=0.494 minSep=2.405 off=0 catchUp=[0.997,1.04] capped=164173
PASS normal        refWin=1    corner=15.41 straight=20.24 maxΔv=12.18 maxStep=0.552 minSep=2.394 off=0 catchUp=[0.997,1.04] capped=66999
PASS hard          refWin=0.45 corner=17.05 straight=21.59 maxΔv=9.42  maxStep=0.586 minSep=2.361 off=0 catchUp=[0.994,1.03] capped=18320
PASS rally-legend  refWin=0.333 corner=17.59 straight=21.94 maxΔv=10.46 maxStep=0.597 minSep=2.356 off=0 catchUp=[0.989,1.03] capped=40135
ALL OK: true
```

## Acceptance criteria → verdict

| AC | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| AC1 | Each tier changes corner speed, reaction and aggression | PASS | `skill`/`reaction`/`aggression` strictly ordered; derived `DriverTuning` differs (tests/difficulty.test.ts) |
| AC2 | Corner speed ordered by tier | PASS | 13.04 < 15.41 < 17.05 < 17.59 (report + test) |
| AC3 | Catch-up capped by a skill cap; never teleports | PASS | `boundedCatchUp` ratio ∈ band, `effectiveSkill ≤ skillCap`, `capped` reported for saturation and every tier's cap is load-bearing |
| AC4 | No teleport / stays on ribbon | PASS | off-surface = 0 on every stage/tier/seed; `maxStepDisplacement ≤ 0.597 m < 1.0` |
| AC5 | Competent human wins on easy, can lose on hard | PASS | refWin easy=1.0 (≥0.80); hard=0.45, legend=0.333 (≤0.60) |
| AC6 | Telemetry shows bounded speed deltas | PASS | `maxSpeedDelta ≤ 15.14 < MAX_SPEED_DELTA(25)`; catch-up ratios inside each tier band |
| AC7 | Back-compat + determinism | PASS | no-tier/no-player == #APEX-7 field; tiered race bit-for-bit deterministic |

## Regression check (epic intent)

- No car leaves the ribbon at any tier: `offSurfaceSamples == 0`, `maxCrossTrack ≤ roadHalfWidth`.
- No overlap reintroduced: `minSeparation > 2 m` on every tier (the #APEX-32 floor) — see `tests/difficulty.test.ts` AC4.
- Visible race still boots and renders four cars at `?race=alpine-forest&difficulty=<tier>` in headless Chromium (SwiftShader WebGL2).

## Residual risk / notes

- `minSeparation` margin under the fastest tier is ~0.35 m above the 2 m floor; the
  catch-up magnitudes were deliberately kept small to preserve it. If a future ticket
  raises tier aggression, re-run the difficulty report gate.
- The "competent human" is a deterministic solo pace benchmark, not a literal human in
  traffic (documented in the openspec); the bands are conservative.

Verdict: **QA PASS**.
