# APEX-27 — Security review

Scope (change under review, commit `4fc24c4`): `src/ai/driver.ts`,
`src/ai/racing-line.ts`, `src/ai/types.ts`, `tests/ai-race-edge.test.ts`.
Reviewed against the OWASP Top 10 (and the OWASP LLM Top 10, which is N/A — no model,
no prompt, no agent in this path) and the workspace engineering standards.

Verdict: **PASS — no exploitable security issue.** One Low, informational API note and
two non-security residual risks are recorded below.

## Threat model

The change is pure numeric controller logic inside a headless, deterministic race
simulation. There is no network, no authentication, no authorisation decision, no
secret, no data store, no PII and no runtime user input on this path.

| Surface | Trust | Handling |
| --- | --- | --- |
| Stage definition JSON (`road.width`, surface `grip`) | Untrusted content | Validated by `parseStage`/schema before it becomes a `StageCircuit`. `road.width` is a number `min: 0.5`; zone `grip` is a number in `[0, 1.5]` and is additionally clamped to `[0.05, 1.5]` by `make()`. The new math consumes only these validated, bounded values. |
| `RacingLine.halfWidth` (new field) | Derived internal value | `circuit.road.width / 2`, i.e. already-validated data. Never serialised, never logged, never rendered. |
| `Surface.lateralGrip` (new read in `driver.ts`) | Validated content | Coefficient in `[0.05, 1.5]`; guarded by `Math.max(0.05, …)`. |

## Findings

- **A03 Injection (XSS / code): none.** The diff adds no markup sink and no dynamic
  execution — grep of the commit is clean for `eval`, `Function(`, `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `javascript:`, `data:`, `fetch`, `XMLHttpRequest`
  and `child_process`.
- **A01 Broken Access Control / least privilege: N/A.** No endpoint, no principal, no
  permission decision. Client-only, headless.
- **A02 / A08 Data integrity / insecure deserialisation: N/A.** No deserialisation,
  `localStorage`, cookies or network access is added.
- **A05 / A06 Misconfiguration / vulnerable components: none.** **No dependency change**
  in the commit — `package.json` and `bun.lock` are untouched, so the CVE surface is
  unchanged. No CDN/remote script is introduced.
- **A07 Auth failures / A09 logging: N/A.** No credentials or secrets, and no logging is
  added (no `console.log`, no telemetry). No PII is handled.
- **A04 Insecure design — availability (DoS) / NaN safety: acceptable.**
  - The race loop is bounded by `maxSeconds / dt`, so the change cannot create
    non-termination. 6,120 simulated races all terminated (`incomplete=0`).
  - Division-by-zero is guarded: `line.halfWidth > 0 ? … : Infinity` (and the schema
    floor of `0.5 m` makes 0 unreachable anyway); `Math.max(lookahead*lookahead, 1)`
    and `Math.max(kReq, 1e-4)` keep denominators ≥ 1.
  - NaN/Infinity propagation was traced by hand: if any input were non-finite, `vTarget`
    degrades to `NaN`, the longitudinal branch falls through to a constant hold-throttle,
    the car simply drives on — **no throw, no unbounded loop**. The change is fail-safe,
    not fail-open.
- **Determinism (integrity of the sim): preserved.** No `Math.random`, no `Date`, no
  clock, no I/O is added; the new code is closed-form arithmetic on existing state.
  Re-running the changed path is bit-identical (`maxCrossTrack` and `finishTime` equal
  across repeat runs, seed 86 and throughout the sweep). AC5 holds.

## Low / informational

- **L1 — `RacingLine.halfWidth` is a new *required* field on an exported interface.**
  `RacingLine` is public (`src/ai/index.ts`). Adding a required property is additive for
  readers but compile-breaking for any external *implementer* that constructs a
  `RacingLine` literal. The only in-repo implementer, `buildRacingLine`, was updated on
  **both** return paths (normal and degenerate), so the repository is self-consistent and
  `tsc --noEmit` is clean. No security impact; note it in the changelog if the type is
  ever re-exported for third parties. Fix decision: **accept** (no action required).

## Residual risk (explicitly out of security scope — surfaced for QA/reviewer)

1. **Introduced finish-window regression (functional, not security).** On
   `mountain-pass` seed `9`, `cpu-3` now finishes at **30.53 s** against a window high of
   **30.27 s** (`1.6 × referenceTime`); on the parent commit `f3d1ca1` the same car
   finished at **28.12 s** (inside the window). This is a real regression introduced by
   this change and it violates AC3 ("#APEX-7 AC4 still holds for seeds 0..299"). It is a
   balance/correctness issue with no security consequence; the shipped `ai-race.test.ts`
   samples only seeds 1/7/42/1234, so CI stays green. Recommend the reviewer/QA seat
   mitigate (e.g. re-tune `edgeEase`/`turnCap` or widen the window) or file a linked bug.
2. **Pre-existing separation violations (not introduced).** For seeds 0..299 several
   stages report `minSeparation ≤ 2.0 m` (alpine-forest 8, desert-dunes 13–15,
   coastal-cliffs 2–3, mountain-pass 1, valley-rally 1). These are present on the parent
   commit as well (baseline: alpine-forest 8, desert-dunes 15) and are therefore **not**
   a regression from this ticket, but they mean #APEX-7 AC3 does not in fact hold over
   seeds 0..299. Out of scope here; flag for a separate ticket.

## Evidence run

- `bun run typecheck` — clean (`tsc --noEmit`).
- `bun run test` — 38 files / 245 tests pass, including the new `ai-race-edge.test.ts`.
- AC2 regression (the 8 reported seeds): all `offSurfaceSamples == 0`.
- AC1 swept: 6 stages × 1,020 seeds (0–999 and 9,980–9,999) = **6,120 races**,
  `off-surface failures = 0`, `incomplete = 0`, global max cross-track 4.648 m
  (≤ each stage's half-width).
- Determinism: repeat runs bit-identical on the changed path.

**Decision: security gate PASS.** No Critical/High/Medium findings; the Low item is
accepted. The functional regressions above are non-security and are left to the
reviewer/QA gate.
