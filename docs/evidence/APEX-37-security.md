# APEX-37 — security review (seat-security, pre-merge gate)

Verdict: **PASS — no blocking findings. Merge approved at the security gate.**
Ticket: `#APEX-37` · PR #24 · branch `fix/APEX-37-hud-speed-time-pace-note` @ `109c6f4`
Diff reviewed: `origin/main...HEAD` (merge-base `0c08e86`, merged `#APEX-11` menus).
Raw audit: `docs/evidence/APEX-37-security-audit.txt`.

## Scope

A client-side-only change that lets the prominent HUD readouts scale with the
user's text-size setting. The effective PR diff is:

- `src/race/hud.ts` — 4 CSS `font-size` rules wrapped in
  `calc(clamp(...) * var(--apex-text-scale, 1))`;
- `tests/hud-text-scale.test.ts` — a static source check (node:fs, local file);
- `scripts/qa-apex37-*.mjs` — dev/QA evidence harnesses (not shipped in `dist/`);
- `docs/evidence/APEX-37-*` — evidence text/JSON/PNG.

No server endpoint, authN/authZ, identity, secrets or egress are introduced.

## Trust boundaries

1. **localStorage (`apex.settings.v1`) → settings model → CSS custom property.**
   `textScale` is user/localStorage-controlled, but `normalizeSettings` runs
   `clampNumber(value, MIN_TEXT_SCALE=1, MAX_TEXT_SCALE=2, 1)`, rejecting
   non-numeric/non-finite values (`src/input/settings.ts`). The value lands in a
   CSS custom property only — it is never part of a selector, at-rule or JS
   sink, so it cannot break out of the style block.
2. **QA evidence harnesses → local `dist/`.** They bind `127.0.0.1:<random>` and
   serve `dist/` with a normalised, `distRoot`-prefix-guarded path handler
   (403 on traversal). Dev/CI only; not part of the shipped bundle.

## STRIDE

| Threat | Assessment |
| --- | --- |
| Spoofing | N/A — no identity/session in the changed surface. |
| Tampering | The only attacker-influenced input is the text-scale value; it is validated and clamped to [1,2] and can only affect the local user's own rendering. |
| Repudiation | N/A — no privileged action. |
| Information disclosure | No secrets/PII added. Secret-pattern scan of the diff: no matches. Evidence holds screenshots, computed font sizes and worktree-local paths only. |
| Denial of service | Bounded. Scale ≤ 2 (clamped); QA proved the four readouts stay inside the viewport with no horizontal truncation at 200% on 1280×800 and 390×844 (`APEX-37-qa-clip-200pct.json`). No unbounded loop or allocation in the diff. |
| Elevation of privilege | N/A — no auth/permission surface. |

## OWASP Top 10 (2021)

| Risk | Assessment |
| --- | --- |
| A01 Broken Access Control | N/A — no endpoints or roles touched. |
| A02 Cryptographic Failures | N/A — no crypto or secrets. |
| A03 Injection | **Clean.** The change is a constant CSS template literal; no `${}` interpolation enters `STYLE`, and no `innerHTML`/`eval`/`new Function`/`document.write` in changed source. The one audit hit is Playwright `page.$eval` in a dev script (not JS `eval`). `var()` cannot inject CSS because it is a property value. |
| A04 Insecure Design | No design change beyond bounded visual scaling; fail-safe default `1`. |
| A05 Security Misconfiguration | No config, headers, CI or secret changes (`git diff` shows none). |
| A06 Vulnerable & Outdated Components | **No dependency change** — `package.json`/`bun.lock` identical. `bun audit`: *No vulnerabilities found (144 packages)*. |
| A07 Identification/Auth | N/A. |
| A08 Software & Data Integrity | No build/release pipeline change; evidence scripts are local-only. |
| A09 Logging/Monitoring Failures | No PII or secrets logged; no new logging. |
| A10 SSRF | N/A — no outbound requests from the product code; harnesses fetch loopback only. |

## LLM Top 10

N/A — the change adds no LLM/AI feature.

## Secrets handling

No secrets read, written, logged or committed. The only env var injected into the
run is the model-provider credential (platform-managed, redacted); it is never
referenced by the diff.

## Findings

| # | Severity | Finding | Decision |
| --- | --- | --- | --- |
| 1 | Info | QA harnesses launch Chromium with `--no-sandbox` and bind a loopback server. Dev/CI-only, not shipped; standard for this repo's evidence scripts. | Note, not blocking |
| 2 | Info | Evidence JSON/TXT include absolute worktree paths (`/root/sarawedi-worktrees/...`). No secret/PII; consistent with existing `docs/evidence`. | Note, not blocking |

No Critical/High/Medium findings. No linked bug ticket opened (no exploitable
issue). Nothing blocks the merge.

## Residual risk

- The fix is purely presentational; the residual security risk is the repo's
  pre-existing dependency and browser-attack surface, unchanged by this PR.
- A malicious local actor with control of the user's own `localStorage` can set the
  text scale, but it is clamped to [1,2] and affects only that user's rendering.

## Verification

- `bun audit` → no vulnerabilities (144 packages).
- `bun run test` → 50 files / 338 tests pass; `tsc --noEmit` clean; `vite build` ok
  (see `APEX-37-qa-tests.txt`, `-qa-typecheck.txt`, `-qa-build.txt`).
