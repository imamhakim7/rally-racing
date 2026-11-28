# APEX-33 — security review

Reviewer: seat-security
Scope: the #APEX-18 QA defect fix — `PaceNoteTracker.pollAnnouncement()` made
idempotent across runtime `setDensity()`/`setLeadDistance()` by replacing the
positional `announcedThrough` cursor with a distance-keyed `Set<number>`
(`src/race/pace-notes.ts`). Consumes #APEX-18; no new surface.

## Verdict: PASS — no blocking findings

The change is internal bookkeeping inside a pure, headless module. It adds no
input, output, dependency, DOM, storage or network surface. Nothing new reaches
a sink: the only downstream consumer is the voice port, which continues to
receive the same bounded, derived phrase.

## STRIDE (change-scoped)

| Threat | Assessment |
| --- | --- |
| **Spoofing** | No authn/authz in scope. Note identity is keyed by `distance`; a crafted duplicate distance could collapse two notes to one announcement, but `buildPaceNotes` yields strictly increasing distances (openspec invariant 2) and stage data is `validateStage`-gated. Functional-only, not a security boundary. |
| **Tampering** | `announced` is `private readonly`; no external writer. Runtime inputs are the same validated setters as before (non-finite guarded, density clamped to [0,1]). |
| **Repudiation** | N/A — no user actions or audit obligations for this pure scheduler. |
| **Information disclosure** | No PII, secrets or free-form data. Spoken text remains the fixed vocabulary `Left/Right n` / `Hairpin left/right`. |
| **Denial of service** | `Set<number>` growth is bounded by the note count (≤ stage samples); `reset()` clears it and a tracker is rebuilt per stage. `has`/`add` are O(1). No unbounded loop or per-frame allocation — the epic's frame-budget invariant is preserved. |
| **Elevation of privilege** | N/A — no privilege boundary on the client. |

## OWASP Top 10 (2021)

| Category | Assessment |
| --- | --- |
| A01 Broken Access Control | N/A — no access control in scope. |
| A02 Cryptographic Failures | N/A — no crypto/secrets. |
| A03 Injection | None — no `eval`/`Function`, no DOM/HTML sink, no SQL/shell; the TTS sink receives a bounded computed phrase. |
| A04 Insecure Design | Improved — the change removes a scheduling-design flaw (non-idempotent announcements); no new design risk. |
| A05 Security Misconfiguration | N/A — no config changed. |
| A06 Vulnerable & Outdated Components | No dependency change; baseline `bun audit` clean (144 packages). |
| A07 Identification & Authentication Failures | N/A. |
| A08 Software & Data Integrity Failures | No deserialization/CI change; stage JSON stays `validateStage`-gated. |
| A09 Security Logging & Monitoring Failures | No sensitive data; change adds no logging (and none is required). |
| A10 SSRF | N/A — module performs no network I/O. |

## LLM Top 10 (2025)

Not applicable. This change contains no LLM/AI feature. The epic's "AI" refers to
CPU-driver heuristics and is untouched here; no prompts, tools, embeddings or
model output are involved.

## Input validation & least privilege

- The touched class validates all runtime numerics: `setDistance` ignores
  non-finite and clamps ≥ 0; `setDensity` clamps to [0,1]; `setLeadDistance`
  guards non-finite and clamps ≥ 0.
- The module holds no platform capabilities; platform access (`speechSynthesis`)
  stays behind the existing `voice.ts` port. Least privilege is preserved.

## Secrets, PII & logging

None handled or emitted. The change touches no secrets and adds no logging.

## Residual risk

Negligible. The only conceptual edge is that note identity is the arc-distance,
so malformed input with duplicate/`NaN` distances would collapse announcements.
The app path cannot produce that (strictly increasing, finite distances from the
`SampledSpline`); noted as an informational item only, not a gate.

## Evidence

- `docs/evidence/APEX-33-security-audit.txt` — dependency-diff check, risky-sink
  scan, secret scan, voice-sink data source, input-validation and growth checks,
  `bun audit` baseline.
- `docs/evidence/APEX-33-tests.txt`, `-typecheck.txt`, `-build.txt` — suite,
  typecheck and production build all green.
