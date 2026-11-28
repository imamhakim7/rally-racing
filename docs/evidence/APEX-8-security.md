# APEX-8 — security review (security gate)

Scope: difficulty tiers + bounded catch-up (`src/ai/*`, contract wiring, scripts).

## Attack-surface assessment

- **No new I/O, network, storage, auth or DOM sink.** The change is pure numeric
  simulation plus a `?difficulty=` URL query. `src/ai/` still imports only
  `src/physics` / `src/stage` (no three.js, no DOM, no fetch, no eval).
- **Untrusted input — `?difficulty=<value>` (main.ts).** Parsed via
  `coerceDifficultyTier`, which type-guards against the fixed `DIFFICULTY_TIERS`
  allow-list and falls back to `"normal"` for anything else. No string interpolation,
  no `innerHTML`, no reflection — an attacker cannot inject code or influence
  rendering.
- **Numerical robustness / fail-safe.** Every public entry point is finite-guarded:
  `difficultyTuning`/`coerceDifficultyTier` never throw on unknown/`null`/`undefined`;
  `boundedCatchUp` returns `ratio 1` for non-finite gap **or** base skill;
  `scaleDriverTuning` neutralises non-finite reaction/aggression. A bad value degrades
  to "no assistance / normal tier", never to `NaN` in a command.
- **Injection via tuning overrides.** `CpuCarSpec.tuning` is a typed
  `Partial<DriverTuning>` (numbers only); the driver's `setCatchUp` additionally clamps
  the multiplier to `[0.5, 2]` and resets non-finite input to `1`.
- **No secrets / credentials / env.** Nothing new is read from the environment; no
  tokens, URLs or keys.
- **Dependencies.** No new third-party dependency, CDN import or asset pin was added.
- **Denial-of-service.** The containment projection runs only when a car crosses the
  ribbon (rare) and is bounded by the spline sample count; the difficulty report is a
  build-time/dev script, not a runtime endpoint.

## Data / privacy

No user data is collected, logged or transmitted. Everything is deterministic
simulation state for a single local browser session.

## Findings

None. No OWASP Top 10 surface is introduced (no auth, injection, SSRF, deserialisation,
or access-control path). Least privilege unchanged.

Verdict: **SECURITY PASS**.

================================================================
INDEPENDENT SECURITY REVIEW — @security seat (PR #27, commit 994c065)
================================================================

Method: STRIDE threat model over the change's trust boundaries, an OWASP Top 10
(2021) pass, and an OWASP LLM Top 10 applicability check. Only boards-safe,
read-only evidence commands were run; no code change was required.

Trust boundaries enumerated
- URL query string (untrusted, browser) -> src/main.ts
- localStorage settings (untrusted, tamperable) -> createLocalStorageStore
- bundled stage JSON / asset manifest (trusted, in-repo)
- new dev scripts (local-only HTTP server) -> scripts/*.mjs

STRIDE
- Spoofing: n/a - no identity, session or auth anywhere in the app.
- Tampering: `?difficulty` is allow-listed via `coerceDifficultyTier` (unknown ->
  "normal"); `?race` via `library.has`; `?ghost` via `Number.parseInt` + finite
  fallback; `?forceUnsupported` via `=== "1"`. Tampered localStorage is re-normalised
  field-by-field in `normalizeSettings` (enums/clamps/booleans, fresh object - no
  spread of untrusted keys, so no prototype pollution). Nothing security-sensitive is
  persisted. PASS.
- Repudiation: n/a - single-user local app, no audit obligation.
- Information disclosure: no PII, no secrets, no network egress (`grep` for
  fetch/XHR/WebSocket/remote import in src -> none); no secrets in src/scripts.
  Persisted data is game settings only. PASS.
- Denial of service: no new loop/query is attacker-controlled; catch-up is bounded
  (`boundedCatchUp` ratio band + skill cap), containment runs O(spline) only on
  ribbon overflow. PASS.
- Elevation of privilege: n/a - client-only, no privileged operation; agent IAM
  unchanged by the diff. PASS.

OWASP Top 10 (2021)
- A01 Broken Access Control: n/a (no server/authz surface).
- A02 Cryptographic Failures: n/a (no secrets/crypto introduced).
- A03 Injection: no `innerHTML`/`eval`/`new Function`/`document.write` added or
  present; no SQL/shell. `?difficulty` cannot reach a property besides a fixed table
  key (e.g. `?difficulty=__proto__` -> "normal"). PASS.
- A04 Insecure Design: catch-up is bounded by design and cannot teleport a car
  (`setCatchUp` only shapes a target speed). PASS.
- A05 Security Misconfiguration: informational - the non-Pages CI workflows do not
  declare `permissions: contents: read` and pin actions by major tag, not SHA.
  Pre-existing, not introduced by this ticket.
- A06 Vulnerable & Outdated Components: `bun audit` -> "No vulnerabilities found
  (checked 144 packages)". No dependency added/changed by this diff. PASS.
- A07 Identification/Auth Failures: n/a.
- A08 Software & Data Integrity: no remote code/asset loading; no CDN pins. PASS.
- A09 Logging/Monitoring: no PII logged; n/a for a client game.
- A10 SSRF: no outbound request path. PASS.

OWASP LLM Top 10: not applicable - no model/LLM feature in this change (the CPU
driver is a deterministic geometric controller, not a trained model).

Supply chain / scripts
- New scripts (`ai-difficulty-report.ts`, `playtest-difficulty.mjs`,
  `screenshot-difficulty.mjs`) are dev/CI-only, not imported by `src/`, so they are
  absent from the shipped bundle.
- `playtest-difficulty.mjs` serves `dist/` on 127.0.0.1 and has a correct traversal
  guard (`normalize(join(...))` then `startsWith(distRoot + sep)` -> 403), loopback
  bind only. PASS.

Data / privacy: unchanged - no collection, no logging, no transmission, no cookies.

Findings: none (Critical/High/Medium/Low = 0). No exploitable issue, so no bug
ticket and no block. Non-blocking observation only: CI workflow permissions/tag
pinning (A05/A08), pre-existing and out of ticket scope.

VERDICT: SECURITY PASS - clears the merge gate.
