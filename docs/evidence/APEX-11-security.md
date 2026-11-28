# APEX-11 — Security gate evidence (pre-merge)

Ticket: **#APEX-11** — Menus, stage select, settings and first-run tutorial
PR: **#23** · branch `feat/APEX-11-menus-stage-select-settings-and`
Gate: `security_testing` (pre-merge) · Reviewed commit: `d2ef3fc` (diff vs `d48abf4`)

**Verdict: PASS — no Critical/High/Medium findings. No merge blocker.**

The change is a **client-side TypeScript/WebGL game UI** with no server, no
authentication, no accounts and no backend calls. There is no authorization
boundary to test; the relevant classes are injection, unsafe local persistence,
dependency risk and secret exposure.

## Attack surface (trust boundaries)

| Surface | Untrusted input | Handling |
| --- | --- | --- |
| URL query `?race=<id>` | user-controlled string | gated by `library.has(raceParam)` before `library.load` |
| URL query `?forceUnsupported=1` | value compared to `"1"` | only selects the support screen |
| `localStorage["apex.settings.v1"]` | user/attacker-editable JSON | parsed in try/catch, normalized field-by-field |
| Stage JSON (`src/stage/data/*.json`) | repo-controlled | schema-validated before use; rendered as text |
| Keyboard events | user input | read into a fixed command shape |

## OWASP Top 10 (applicable items)

| OWASP | Result | Evidence |
| --- | --- | --- |
| A03 Injection (XSS) | **PASS** | No `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` in `src/` or `index.html`. All dynamic text (stage name, biome, length, difficulty, lesson copy, status) uses `textContent` (`src/ui/menu.ts`, `src/ui/tutorialOverlay.ts`); glyphs via `String.repeat` on clamped integers. No `href`/`src`/`srcdoc` assignment; no `postMessage`. |
| A05 Misconfiguration | **PASS** | No CSP/headers introduced or weakened (static Vite site); `index.html` diff is CSS + host-element only. |
| A06 Vulnerable components | **PASS** | `package.json` and `bun.lock` are **unchanged** by the PR; no new dependency, CDN import or runtime fetch. |
| A08 Integrity | **PASS** | Persisted settings cannot brick boot or inject: `normalizeSettings` (#APEX-12, extended here with a `game` section) builds a **fresh object from named fields**, type-checks/allowlists/clamps every value, and never throws. Corrupt/blocked storage falls back to defaults. |
| A01/A02/A04/A07/A09/A10, LLM Top 10 | **N/A** | No auth, crypto, server, SSRF or AI feature in this change. |

## Findings

None blocking. Findings are recorded at their true severity:

- **[Informational]** `window.apexStage` / `window.apexRace` expose app internals
  (`library`, `scene`, `app`, `race`, `menu`, `settings`, `startTutorial`) for the
  smoke/evidence tooling (`src/main.ts`). This is **not a trust boundary**: any
  script able to read these globals already executes with full page privileges.
  Pattern pre-exists (#APEX-7/#APEX-10) and is extended, not newly introduced.
- **[Low — residual, tracked in #APEX-12]** Menu/tutorial overlays have no focus
  trap; Tab can reach background content. WCAG/a11y gap, not a security bypass.
- **[Low — residual]** Same-origin `localStorage` tampering is possible only after
  an independent XSS; this change introduces no XSS sink and the tampered values
  are normalized. Impact is a corrupted local preference only.

## Secrets / PII

No secrets, tokens, credentials or PII in `src/`, `index.html` or `scripts/`.
The committed evidence JSON (`docs/evidence/APEX-11-menu.json`) contains only
preference/binding values — no sensitive data.

## Dependency & supply-chain check

```
$ git diff d48abf4..HEAD -- package.json bun.lock     # empty
$ grep -rn "fetch(|XMLHttpRequest|WebSocket|EventSource" src index.html   # none
```

## How this was verified

- Static sink scan of the PR diff: `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval|new Function`.
- Untrusted-input trace for the query params and the settings store.
- `git diff` confirms no dependency/lock change and no runtime network calls.
- CI gates on the branch stay green (typecheck, 49 files/336 tests, build,
  `smoke:browsers`, `check-a11y.mjs`).

## Gate decision

**PASS — safe to merge.** No bug ticket opened (no defect). Residual risks above
are Low/Informational and already owned by #APEX-12 (a11y) or inherent to a
same-origin static game.
