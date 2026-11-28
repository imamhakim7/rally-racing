# APEX-9 QA — Deterministic headless simulation harness and ghost replays

- Ticket: #APEX-9 (`chore`), epic `2026-Q4-APEX-RALLY-APEX-03`.
- Branch / commit: `chore/APEX-9-deterministic-headless-simulation-harnes` @ `15a258f`
  (PR imamhakim7/rally-racing#25 merged; `origin/main == 15a258f`).
- Verifier: seat-qa (independent run; not a re-run of the dev/reviewer evidence).
- Inputs consumed: `docs/openspecs/APEX-9.md`; upstream #APEX-7 (`simulateRace`,
  `CpuDriver`, `RacingLine`, `RaceResult`) is `deployed_to_production`.
- **Verdict: PASS — all of AC1–AC6. No blocking defect.**

Environment: Node runtime `bun 1.4.4`; no GPU (headless Chromium/SwiftShader when a
browser is used); `bun install --frozen-lockfile` from the committed lockfile.

## Per-criterion verdict

### AC1 Identical results across runs — PASS
Given a seeded stage + car field, two runs (same process and fresh processes) are
byte-identical in finish order, per-car finish times and `traceHash`.
- Two independent `bun scripts/headless-race.ts` processes at seeds `1,7,42` over
  all 6 shipped stages (18 runs): `diff` of both JSON and TXT is empty
  (`docs/evidence/APEX-9-qa-determinism.txt`).
- My run reproduces the committed artifact byte-for-byte:
  `sha256 /tmp/apex9-qa-a.json == 3f145740a9686c096d342ed98ae9d6f1dc5638eec30930ebb016f53c733c9f7c == docs/evidence/APEX-9-determinism.json`.
- All 18 runs `deterministic=true`; unit coverage
  (`tests/ai-replay.test.ts`) also asserts equal hash and a changed seed changes the
  hash (21/21 focused tests pass, `docs/evidence/APEX-9-qa-tests.txt`).

### AC2 Replay trace captured — PASS
A recorded race has one `TraceFrame` per `sampleEvery` steps, a pose for every car in
stable id order, a `finishOrder` and checkpoint splits.
- `src/ai/capture.ts` records at `frame.step % traceEvery === 0` with `sampleEvery:1`
  internally (splits at full resolution), then `recordTrace` stamps `sampleEvery`.
- Harness reports for every stage/seed show strictly increasing frame steps, 4 cars
  per frame, per-checkpoint splits in gate order and the implicit `finish@1.000`
  split equal to the car's `finishTime` (`docs/evidence/APEX-9-qa-determinism.txt`).
- Unit: "captures one frame per sample interval with a pose per car" passes.

### AC3 Trace round-trips — PASS
- `parseTrace(serializeTrace(t))` deep-equals `t` and re-serialises to the same hash;
  every harness run reports `roundtrip=true` (`traceHash(parsed) === hash`).
- Negative: `{}`, `"not json"` and a tampered `version:999` document all throw
  `TraceParseError` (tests `rejects malformed or unsupported documents`; committed
  `parseTrace` never returns a partially-valid trace).

### AC4 Ghost can be raced against a recorded run — PASS
- In the real production bundle, `?race=alpine-forest&ghost=7` boots the live race
  (`webgl2:true`, `carCount:4`, `circuitId:alpine-forest`), runs (simTime advanced) and
  the overlay's recorded finish order `[cpu-2,cpu-1,cpu-4,cpu-3]` equals the harness
  `finishOrder` for `alpine-forest` seed 7, with no page/console errors
  (`docs/evidence/APEX-9-qa-ghost.json`; screenshot `docs/evidence/APEX-9-ghost.png`).
- `GhostOverlay.poseAt` clamps before/after the recording, interpolates between frames
  and returns `null` only for an empty trace; single-frame returns that frame (unit).
- Boundary/negative in the real dist (`docs/evidence/APEX-9-qa-ghost-boundary.txt`):
  non-numeric `ghost=abc` defaults to seed 7; `ghost=0` disables the ghost;
  `ghost` without `?race` is ignored; `?race=not-a-stage` boots without the AI race —
  all with zero console/page errors.

### AC5 CI determinism gate — PASS
- `.github/workflows/determinism.yml` installs from the frozen lockfile, typechecks,
  runs `tests/ai-replay.test.ts` + `tests/ai-race.test.ts`, runs the seeded gate on
  every shipped stage, then runs it a second time in a fresh process and `diff`s the
  JSON+TXT. No GPU and no network.
- I executed the exact gate locally: `bun scripts/headless-race.ts` exits `0` with
  `ALL OK: true` / `VERDICT: PASS`, and the two fresh-process outputs are identical.
- The gate fails closed: `scripts/headless-race.ts` sets `process.exitCode = 1` when
  any stage diverges, fails round-trip, or violates the #APEX-7 contract, and the CI
  `diff` step exits non-zero on cross-run divergence.

### AC6 Nothing regressed — PASS
- `bun run typecheck` clean (`docs/evidence/APEX-9-qa-typecheck.txt`).
- `bun run test`: 51 files / 348 tests pass (`docs/evidence/APEX-9-qa-tests.txt`).
- `bun run build` succeeds (77 modules); no `node:crypto` leaked into `dist/`
  (replay hashing stays node-only; `src/ai/index.ts` does not re-export it).
- The visible race scene still boots in headless Chromium from the real build
  (AC4 evidence); the static boot-wiring seam test `tests/boot-wiring.test.ts` pins
  `get("race")`, `createAiRaceScene(` and `window.apexRace =` by name.

## Epic intent (2026-Q4-APEX-RALLY-APEX-03)

The harness is the reproducibility substrate the epic needs: it re-asserts the #APEX-7
balance contract through every seeded run — all cars finish, `offSurfaceSamples === 0`,
`cornerMeanSpeed < straightMeanSpeed`, finish inside the per-stage window, and
`minSeparation > 2.0` (observed minimum `2.3666`). It also serialises the recorded
`skill` per car, which is what #APEX-8 (difficulty tiers) tunes against. This satisfies
"Cpu drivers race credibly ... races stay close but fair" with a regression gate.

## Edge cases exercised

- Empty trace → `sampleGhost` returns `null`; serialise/parse do not throw.
- Single-frame trace → that frame for any time.
- Non-finisher → no finish split, `complete:false` (contract gate rejects it).
- `sampleEvery/traceEvery` clamped to a positive floor (`>=1`).
- Unknown trace `version` → typed `TraceParseError`.
- Different seed → different `traceHash` (determinism is not trivial equality).

## Honest limitations (non-blocking)

- Splits use racing-line progress vs checkpoint arc fractions; the finish split uses
  the exact `CarResult.finishTime`, so it cannot disagree with the result. A checkpoint
  split can differ from a centreline projection by a frame — immaterial for tuning.
- The shipped browser ghost records the reference run in-process (`?ghost=<seed>`);
  it does not fetch external trace files (out of scope per the openspec non-goals).

## Evidence

- `docs/evidence/APEX-9-qa-typecheck.txt`
- `docs/evidence/APEX-9-qa-tests.txt`
- `docs/evidence/APEX-9-qa-determinism.txt`
- `docs/evidence/APEX-9-qa-ghost.json`
- `docs/evidence/APEX-9-qa-ghost-boundary.txt`
- `docs/evidence/APEX-9-determinism.json` / `.txt` (reproduced exactly)
- `docs/evidence/APEX-9-ghost.png` (re-captured independently; unchanged evidence file)
