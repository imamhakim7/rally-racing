# APEX-12 — security gate (input abstraction + accessibility)

Seat: **security**. Gate: `security_testing`. Branch:
`feat/APEX-12-input-abstraction-and-accessibility-game`, commit `efde792`
(PR #22). Verdict: **PASS — no blocking findings.**

## Scope

`src/input/*` (`actions`, `bindings`, `keyboard`, `gamepad`, `touch`, `manager`,
`settings`), `src/ui/*` (`a11y`, `palette`, `settingsPanel`, `touchControls`,
`motionBlur`), `src/engine/motion.ts`, `src/scenes/aiRaceScene.ts`,
`src/race/hud.ts`, `src/main.ts`, plus tests and evidence scripts.

This is a **client-only, single-player** feature: no server, no accounts, no
authN/authZ, no request handling. The relevant trust boundary is the browser
origin the app runs in, and the only new untrusted input is **persisted settings**
in `localStorage` (same-origin; tamperable by other origin scripts or a user with
devtools) plus keyboard/pointer/gamepad events.

## Threat model (STRIDE) at the new boundary

| STRIDE | Vector | Control | Verdict |
| --- | --- | --- | --- |
| Spoofing | — no identity in this feature | n/a | n/a |
| Tampering | hostile/corrupt `localStorage` settings | `normalizeSettings` / `normalizeBindings` validate shape, reject unknown enums, clamp numbers, dedupe, never throw; store wraps `JSON.parse`/`setItem` in `try/catch` | mitigated |
| Repudiation | — no privileged actions | n/a | n/a |
| Information disclosure | settings store contents | only binding codes, enum strings and numbers; no PII, no secrets, no logging of settings | mitigated |
| Denial of service | oversized persisted payload | parsing/normalising a 10 MB, 200k-entry payload is bounded (~50 ms) and dedupes to ≤1 binding per action; localStorage quota caps size | low residual |
| Elevation of privilege | — no auth/roles | n/a | n/a |
| DOM injection (XSS) | settings/bindings rendered into the UI | every new node uses `createElement` + `textContent`; no `innerHTML`/`insertAdjacentHTML`/`eval`/`new Function`; CSS vars come from fixed palettes + a numeric scale | mitigated |

## OWASP Top 10 (client-side mapping)

- **A03 Injection** — no HTML/JS/CSS sinks from untrusted data. Hostile
  `colorBlindMode`/`textScale` values are rejected by the enum/range validators and
  fall back to defaults; palette CSS vars are selected from a fixed table.
- **A05 Security misconfiguration / A06 vulnerable components** — no new
  dependency; pinned floor unchanged; `bun audit` reports **no vulnerabilities
  (144 packages)**.
- **A08 Data integrity / A09 logging** — no deserialisation of executable data
  (only `JSON.parse` into validated, non-executed structures); no settings/PII
  logging.
- **A01/A02/A07/A10** — not applicable (no access control, crypto, or server-side
  request forgery in this client-only slice).

## Independent verification (security seat)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | clean |
| Unit/integration | `bun run test` | 47 files / **318 pass** |
| Build | `bun run build` | ok |
| Dependency CVEs | `bun audit` | **No vulnerabilities (144 packages)** |
| Deps unchanged | `git diff a8d74fd..efde792 -- package.json bun.lock` | empty |
| Sink scan | `grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write\|eval(\|new Function" src/` | none |
| URL/attr scan | `grep -rn "\.href\s*=\|\.src\s*=\|location\s*=" src/` | none |
| Hostile settings probe | crafted `__proto__`/bad-enum/huge payload through `normalizeSettings` + `createLocalStorageStore` | defaults restored; **no prototype pollution**; 10 MB payload ≈50 ms, deduped |
| Reduced motion (a11y gate) | `bun scripts/check-a11y.mjs` | **ok:true**; reduced effects `{shake:0,blur:0}` and blur overlay hidden |

The hostile-settings probe:

```
normalized: {"reducedMotion":"auto","colorBlindMode":"default","textScale":1} deadzone=0.15
throttle binding: [{"device":"keyboard","kind":"button","code":"KeyI"}]
polluted prototype? false
corrupt JSON -> defaults
200k-entry payload time(ms): 50.4 -> deduped to 1 binding
```

## Findings

| ID | Severity | Finding | Decision |
| --- | --- | --- | --- |
| APEX-12-S1 | Low (informational) | A same-origin actor can persist a large/odd settings blob; worst case is ~50 ms local parse and nonsensical bindings — no code execution, no data exposure. | Accept (residual). QoU cap already applied via de-dup + `try/catch`. |
| APEX-12-S2 | Low (informational) | `window.apexStage.input` exposes the `InputManager` to page scripts, matching the existing `window.apexStage` tooling surface (`library`/`scene`/`race`). No sensitive data. | Accept (consistent with existing pattern). |

No Critical/High/Medium issues. No exploitable path found; no bug ticket opened
(no reproduction to file).

## Residual risk (explicit)

- Persisted settings remain tamperable by any script on the same origin — inherent
  to `localStorage`; the data is non-sensitive and validated on read.
- Local self-DoS via an oversized storage blob is bounded but not eliminated.
- Not audited here: the pre-existing `?race=` query handling and upstream modules
  (unchanged by this ticket, covered by earlier gates).
- **Merge-order risk (#APEX-11 rebase) — owned by the lead/orchestrator, not a
  defect in this code.** The lead has designated #APEX-11 (still `in_development`)
  as the owner of `src/main.ts` boot wiring and of its settings store
  (`src/ui/settings.ts`), while this branch owns `src/input/settings.ts`; three live
  branches edit `src/main.ts` (#APEX-11, #APEX-12, #APEX-17/PR #21). This gate's PASS
  is for the code **as committed**. The rebase must **preserve the validated settings
  path** (`normalizeSettings` / `normalizeBindings`) and the boot-wiring test seams,
  and must **not leave two competing settings modules** — a careless conflict
  resolution could silently revert input validation (the #APEX-26 regression class).
  Re-run at least `bun run test` (ideally this full gate) after the rebase.

## Knowledge feedback

No new *defect class* was found, so no `.opencode/skill/*` rule or
`docs/security/lessons.md` entry is required. The relevant standing rule (validate
untrusted persisted input; no HTML sinks) already held and is exercised by
`tests/input-settings.test.ts` + `tests/a11y.test.ts`.

## Decision

**PASS.** No Critical/High/Medium findings on the code in this PR (#22);
security gate satisfied and merge unblocked **for the current commit `efde792`**.
Condition of the pass: the #APEX-11 rebase is resolved as above (single settings
module, validated settings path and boot-wiring seams preserved), after which this
gate should be re-run. No bug ticket opened — nothing exploitable was reproduced.

Evidence: `APEX-12-tests.txt`, `APEX-12-typecheck.txt`, `APEX-12-a11y.txt`,
`APEX-12-input.txt`, this file.
