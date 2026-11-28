# APEX-8 — QA verification (independent, seat-qa)

Ticket: Difficulty tiers and fair catch-up tuning.
Epic: `2026-Q4-APEX-RALLY-APEX-03` — CPU Opponents & Racing Balance.
Branch: `feat/APEX-8-difficulty-tiers-and-fair-catch` @ `9f47c95` (PR #27 merged).
Verdict: **QA PASS**.

## What was independently verified

The QA seat re-derived the acceptance evidence with a **different seed base** and an
**independent no-teleport measurement path** than the dev report / unit tests:

- QA sweep: `7311001 + 137·i`, 25 seeds × 6 stages × 4 tiers = **600 races**
  (dev report used `5000 + 29·i`; unit tests used `500 + 31·i`).
- Per-step displacement measured **frame-to-frame from the #APEX-9 `onStep`
  observation callback** (sampleEvery = 1), not from the simulator's own
  `maxStepDisplacement` accumulator — a second, independent way to catch a teleport.
- `boundedCatchUp` exercised with **200,000 randomised configs/gaps** including
  `NaN`, `±Infinity`, `±1e300`, and huge/negative/zero `fullGapRange`.

### Commands (reproducible from the branch)

| Command | Result | Evidence |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 68 packages, clean | this run |
| `bun run typecheck` | exit 0 | `APEX-8-qa-build-tests.txt` |
| `bunx vitest run` | 52 files / 365 passed | `APEX-8-qa-build-tests.txt` |
| `bun run build` | built, exit 0 | `APEX-8-qa-build-tests.txt` |
| `bun scripts/qa-apex8-independent.ts` | **ALL CHECKS PASS** (exit 0) | `APEX-8-qa-independent.{json,txt}` |
| `bun scripts/ai-difficulty-report.ts --seeds=30` | `ALL OK: true` | `APEX-8-qa-difficulty-report.{json,txt}` |
| `bun scripts/playtest-difficulty.mjs` (built race, headless Chromium) | `ALL OK: true` (8 races) | `APEX-8-qa-playtest.json` |

### Independent seeded sweep (600 races)

```
easy          refWin=1.000 corner=13.06 maxΔv=15.14 traceStep=0.494 minSep=2.350 off=0 capped=226207
normal        refWin=1.000 corner=15.41 maxΔv=12.28 traceStep=0.553 minSep=2.292 off=0 capped=97132
hard          refWin=0.420 corner=17.04 maxΔv=9.42  traceStep=0.586 minSep=2.363 off=0 capped=38383
rally-legend  refWin=0.333 corner=17.57 maxΔv=10.46 traceStep=0.597 minSep=2.396 off=0 capped=70021
```

### Visible-race playtest (built `dist`, headless Chromium + SwiftShader WebGL2)

```
alpine-forest/easy         spread=30.58 maxSpeedStep=2.55 minSep=2.502 off=0 corner<straight=true
alpine-forest/hard         spread=33.68 maxSpeedStep=2.30 minSep=2.484 off=0 corner<straight=true
canyon-sprint/rally-legend spread=42.94 maxSpeedStep=1.32 minSep=2.482 off=0 corner<straight=true
... all 8 stage×tier runs PASS
```

Pack spread stayed ≤ 42.9 m (bound 120 m), max per-frame speed step ≤ 2.55 m/s
(bound 6 m/s) — bounded and natural, no teleport-like pops.

## Acceptance criteria → verdict

| AC (ticket wording) | Result | Evidence |
| --- | --- | --- |
| Each tier changes corner speed, reaction and aggression | **PASS** | `skill`/`reaction`/`aggression` strictly increase easy→rally-legend; derived `DriverTuning` ordering (heading, cross, overtake, minGap) verified; `createRaceField` scales both skill and tuning; corner speed strictly ordered 13.06 < 15.41 < 17.04 < 17.57 |
| Catch-up capped by a skill cap and never teleports cars | **PASS** | 200k randomised `boundedCatchUp` calls: ratio in `[1−maxSlow,1+maxBoost]`, `effectiveSkill ≤ skillCap`, `capped` on saturation; `skillCap` load-bearing and exercised on every tier; in-engine and independent trace per-step displacement ≤ 0.597 m < `MAX_STEP_DISPLACEMENT` (1.0 m) |
| A competent human wins on easy and can lose on hard | **PASS** | reference human (skill 1.0, tier-independent baseline) refWin: easy 1.000 ≥ 0.80; hard 0.420 ≤ 0.60; rally-legend 0.333 ≤ 0.60 |
| Telemetry shows bounded speed deltas between player and pack | **PASS** | `maxSpeedDelta` ≤ 15.14 m/s < `MAX_SPEED_DELTA` (25) on all tiers; per-car `maxSpeedDeltaFromReference` also bounded; applied catch-up ratio ranges inside each tier band |

## Edge / negative / regression checks

- **Untrusted tier input**: `coerceDifficultyTier` maps `"bogus"`, `"EASY"`, `42`, `{}`, `null`, `undefined` → `normal`; valid tiers round-trip. The `?difficulty=` URL path therefore fails safe to `normal`.
- **Non-finite catch-up inputs**: `NaN`/`±Infinity` gap ⇒ ratio 1; non-finite/≤0 base skill ⇒ ratio 1; `fullGapRange ≤ 0` guarded.
- **Back-compat**: omitting `tier`/`player` reproduces the #APEX-7 field exactly (identical finish times), telemetry null.
- **Determinism**: identical tiered inputs serialise bit-for-bit equal.
- **Containment/epic intent**: `offSurfaceSamples == 0` and `minSeparation > 2 m` on every stage × tier × seed (600 races) — a faster/aggressive tier never leaves the ribbon or reintroduces overlap.
- **Wiring**: the tier reaches the visible race field (`createRaceField`) and the `?difficulty=` query, not just the headless simulator.

## Non-blocking observation (not a defect in scope)

`boundedCatchUp`'s doc-comment says the ratio bound holds "for every input". That
holds whenever `skillCap ≥ baseSkill` (true for **all four shipped tiers**, including
the ±1.5 % field jitter — asserted in `AC3.cap-domain`). If a caller deliberately
passes an explicit `RaceOptions.cars[].skill` **above the tier's cap** (e.g. skill 1.2
on `easy`, cap 0.83), the cap correctly slows that car, and the reported
`catchUp.minRatio` is `cap/base ≈ 0.69` — outside the rubber-band band. This is the
cap doing its job on an out-of-tier request, not a catch-up bound breach, and it does
not affect any shipped/ default field or any acceptance criterion. Flagged for a
future telemetry-semantics cleanup if `#APEX-9` ever grades explicit-skill fields.

## Residual risk

- `minSeparation` margin under the fastest tier is ~0.29 m above the 2 m floor; a
  future increase in tier aggression must re-run the report gate.
- The "competent human" is a deterministic solo pace benchmark (documented in the
  openspec), not a literal human in traffic; bands are conservative.

Verdict: **QA PASS** — no blocking defects, no linked bug opened.
