# APEX-28 — security review (independent seat-security run)

Verdict: **PASS — no blocking findings, merge approved at the security gate.**
Ticket: #APEX-28 · PR #12 · branch `feat/APEX-28-terrain-foundation-heightfield-biome-sur`
Raw audit: `docs/evidence/APEX-28-security-audit.txt`.

## Scope / trust boundaries

This is a client-side WebGL game change. It adds **no server endpoint, no authN/
authZ path, no identity or IAM surface, no secret and no egress**. The only
externally-influenced input is the **stage JSON** (`terrain` block), which is a
build-time, repo-committed asset — not runtime attacker input. The validator
(#APEX-4) remains the trust boundary and this ticket extends it fail-closed.

## STRIDE

| Threat | Assessment |
| --- | --- |
| Spoofing | N/A — no identity or session in the changed surface. |
| Tampering | Stage JSON is content-addressed build input; the new `terrain` fields are schema-validated before any geometry is built. No runtime mutation path. |
| Repudiation | N/A — no privileged action. |
| Information disclosure | No secrets/PII introduced; evidence files hold public stage stats and rendered screenshots only (scan: no matches). |
| Denial of service | Bounded: `resolution` 5..32, `relief` 0..60, `corridorWidth` 4..400, integer `seed` ≥ 0; along-sections capped at 240 (≤7680 verts / 14818 tris); fixed 4-octave noise; containment projection O(spline samples). See `.txt` §8. |
| Elevation of privilege | N/A. |

## OWASP Top 10 (web)

| Risk | Assessment |
| --- | --- |
| A01 Broken Access Control | N/A (no endpoints). |
| A02 Cryptographic Failures | N/A (no crypto/secrets). |
| A03 Injection | **Clean** — no `innerHTML`/`eval`/`new Function`/`document.write` in changed source; the evidence static server reuses the repo's normalised, prefix-guarded file handler and binds `127.0.0.1` only. |
| A04 Insecure Design | Budget/fail-closed caps are part of the design. |
| A05 Misconfiguration | No config/secret changes; new evidence script is dev/CI-only. |
| A06 Vulnerable Components | **No new runtime dependency** (package.json delta adds one script). `bun audit`: *No vulnerabilities found (144 packages)*. `three` pinned at `0.187.0` in the lockfile. |
| A07 Identification/Auth | N/A. |
| A08 Integrity | No CI/asset-pipeline change beyond the new local evidence script. |
| A09 Logging/Monitoring | No PII or secrets logged; errors are generic. |
| A10 SSRF | N/A — no outbound requests. |

## Findings

- **None Critical / High / Medium.**
- **LOW (informational) — `--no-sandbox` in `scripts/screenshot-terrain.mjs`.**
  The script launches a throwaway Chromium against a `127.0.0.1` static server
  serving only `dist/`. This mirrors the existing, accepted `screenshot-*.mjs`
  pattern and never runs in production. Keep it dev/CI-only (as it is).
- **LOW (pre-existing, not introduced here) — unbounded `spline.points`.**
  The #APEX-4 schema bounds `terrain` but not the spline `points` array length;
  a hostile *authoring* pipeline could make the sampler allocate heavily. Stage
  JSON is trusted build input, so this is not exploitable at runtime. Recommend
  the format owner (#APEX-4) add a `maxItems` bound in a future hardening pass.
  Tracked here as a non-blocking note; no bug ticket required for #APEX-28.

## Least privilege

No new permission or capability is requested; the new evidence script only reads
`dist/` and writes `docs/evidence/`. No elevated operations.

## Residual risk

Low and bounded: terrain ingest is authored content with a fail-closed validator
and hard caps; the only residual item is the pre-existing unbounded spline-point
array owned by #APEX-4. No secrets, PII, or network surface exist to leak.

## Evidence

- `docs/evidence/APEX-28-security-audit.txt` — sinks, dep delta, secret scan,
  egress scan, `bun audit`, fail-closed validation probe, focused tests, typecheck,
  DoS-bound math.
- Focused security tests: 22 passed (`stage-containment`, `stage-terrain`,
  `stage-surface-grip`, `stage-validate`); `tsc --noEmit` clean.
