# APEX-18 — pre-merge security review

Gate: `security_testing` (PR #16). Reviewer: seat-security.
Diff: `origin/main...HEAD` = `a10d3bb...f77ef66` (co-driver pace notes, #APEX-18).

## Verdict: PASS — no blocking findings. Merge may proceed.

Threat-modeled the change against its trust boundaries; nothing exploitable, no
secrets, no new supply-chain surface.

## Trust boundaries & STRIDE

| Boundary | Threat | Assessment |
| --- | --- | --- |
| Stage file → note derivation | **Tampering** | Stage JSON already passes `validateStage`; the note builder is a pure read-only function over the sampled centreline. No code/format execution from data. |
| Car state → `PaceNoteTracker` | **DoS** | `setDistance` ignores non-finite input and clamps ≥0; `upperBound` is O(log n) + a bounded lead-window scan; `nearestDistanceOnSpline` is O(samples ~150–285)/frame. No unbounded loops. |
| Notes → HUD DOM | **Injection (XSS)** | Note text is written with `textContent` only; no `innerHTML`/HTML parsing. `note.call` is generated from `direction` + `severity` (a closed set), not free-form stage strings. |
| Notes → Web Speech API | **Injection / abuse** | `voice.speak()` receives only `note.call` (`"Right 3"`, `"Hairpin left"`); checkpoint names are **not** spoken. `speak()` ignores empty text and swallows backend throws. |
| App → `window.apexStage.pace` | **Info disclosure / EoP** | Exposes in-memory `{ tracker, voice }` game objects for tooling, mirroring the pre-existing `window.apexStage`/`window.apexRace`. No credentials, tokens or PII; no capability escalation. |
| Dev script → local HTTP server | **Misconfig / path traversal** | `scripts/screenshot-pace-notes.mjs` is dev-only (not bundled). Binds `127.0.0.1` on an ephemeral port; path is `normalize`d and gated by `startsWith(distRoot + sep)`; malformed URLs fall through to 404. Informational. |

Spoofing / Repudiation / Elevation of privilege: not applicable — offline,
single-player, client-side, no identity or privileged operations.

## OWASP Top 10 (2021)

- **A01 Access Control** — n/a (no server authz).
- **A02 Cryptographic Failures** — n/a (no crypto/data at rest).
- **A03 Injection** — PASS: DOM writes via `textContent`; TTS input is synthesized,
  not attacker-controlled; no SQL/command sinks.
- **A04 Insecure Design** — PASS: pure, data-derived logic; no new trust boundary.
- **A05 Security Misconfiguration** — PASS: dev server localhost-only + traversal
  guard. Informational note above.
- **A06 Vulnerable & Outdated Components** — PASS: **no changes** to `package.json`
  or `bun.lock`; no new dependencies.
- **A07 Auth Failures** — n/a.
- **A08 Software & Data Integrity** — PASS: no untrusted deserialization beyond the
  existing stage validator; deterministic pure functions.
- **A09 Logging & Monitoring** — PASS: no sensitive data logged; no PII.
- **A10 SSRF** — PASS: no outbound requests/URL fetching.

LLM Top 10: not applicable — no AI/LLM feature; derivation is a deterministic
rule-based function.

## Secrets

No secrets, keys, tokens or `.env` changes in the diff. `git diff` token scan is
clean (only the prose word "token"/"secret" inside the existing evidence docs).

## Dependency risk

Zero manifest/lockfile changes; no new transitive packages. No CVE surface added.

## Residual risk

Low. The only residual item is the intentional `window.apexStage.pace` tooling hook
(in-memory game state only) and the dev-only local static server — neither reaches
production. Accepted.

## Evidence

- `docs/evidence/APEX-18-security-audit.txt` — machine scan (deps, sinks, secrets,
  DOM, speech, server) from this run.
- `docs/evidence/APEX-18-tests.txt`, `-typecheck.txt`, `-build.txt`,
  `-browser.txt` — functional evidence from the code-review/QA gates.
