# APEX-6 — Security review (asset pipeline)

Reviewer: `seat-security` · PR #6 · branch `chore/APEX-6-gltf-ktx2-asset-pipeline-with`
Scope: the glTF/KTX2 asset pipeline, its CI workflow, and the evidence it emits.

**Verdict: PASS — no Critical or High findings. No exploitable issue, so no blocking
bug ticket.** Residual risk and recommended hardening are stated below.

## Change under review

A build-time asset pipeline (`src/assets/*`) plus a CI workflow
(`.github/workflows/assets-budget.yml`). It reads committed source assets, compresses
them (meshopt/Draco + KTX2/Basis), content-hashes them, writes a manifest with immutable
cache headers, and gates on byte/load budgets. No server, no network calls, no user
input at runtime, no authentication surface, no PII.

## Trust boundaries

1. **Contributor → repo/CI** — `assets/source/**` and `docs/assets/*.json` are parsed in
   CI by native/wasm decoders (sharp/libvips, basis, draco). The only untrusted-input
   boundary.
2. **CI → artifacts/CDN** — hashed assets + `manifest.json` with
   `Cache-Control: public, max-age=31536000, immutable`.
3. **Build dependencies → build host** — npm packages (postinstall/native) run at
   `bun install`.
4. **Future runtime loader → manifest** — out of scope; consumes the manifest contract.

## STRIDE

| Threat | Assessment |
| --- | --- |
| Spoofing | No identity/authentication surface. N/A. |
| Tampering | Outputs are content-addressed (sha256[:8]); consumers *can* detect tampering, though the runtime loader is out of scope. CI supply chain is the relevant vector (see SEC-1). |
| Repudiation | No actor/audit surface. N/A. |
| Information disclosure | None: no secrets, no PII, no network egress. Evidence contains only file names, sizes and hashes. Secret scan of the diff is clean. |
| Denial of service | PR-supplied assets are decoded with no pre-decode size cap (SEC-2). |
| Elevation of privilege | No privilege surface in the pipeline. CI token scope is the only lever (SEC-1). |

## OWASP Top 10 (2021) / LLM Top 10

- **A03 Injection** — no SQL/shell/HTML sinks. No `eval`, `child_process`, `fetch` or
  dynamic `require` anywhere in the change (verified by grep).
- **A05 Security misconfiguration** — immutable caching is correctly scoped to hashed
  files only; `manifest.json` cache policy is unstated (SEC-4).
- **A06 Vulnerable & outdated components** — `bun audit` reports **no vulnerabilities
  (144 packages)**. Pipeline-critical deps are exact-pinned
  (`@gltf-transform/* 4.5.1`, `draco3d 1.5.9`, `ktx2-encoder 0.6.0`,
  `meshoptimizer 1.3.0`, `sharp 0.35.5`). CI installs with `--frozen-lockfile`.
- **A08 Software & data integrity** — content addressing is sound; CI action pinning is
  the gap (SEC-1).
- **A09 Logging** — no sensitive data logged.
- **A01/A02/A04/A07/A10** — no access-control, crypto, design or SSRF surface.
- **LLM Top 10** — not applicable: no AI/LLM feature in this change.

## Findings

### SEC-1 — CI least privilege & mutable action tags (Low, supply chain)
`.github/workflows/assets-budget.yml` declares no `permissions:` block (default token may
be broad) and pins actions by mutable major tag (`actions/checkout@v4`,
`oven-sh/setup-bun@v2`, `actions/upload-artifact@v4`). A moved/compromised upstream tag
would execute arbitrary code on the runner. Not currently exploitable: no `pull_request_target`,
no secrets in the workflow, and `pull_request` from forks gets a read-only token — the
`push` trigger only fires on in-repo branches.
**Fix:** add `permissions: { contents: read }` and pin actions to full commit SHAs.

### SEC-2 — Unbounded asset decoding (Low, DoS)
The pipeline reads any committed source file and decodes/encodes it with no pre-decode
size cap (`src/assets/pipeline.ts` has no `maxBytes`/`statSync` guard). A large or crafted
image/glTF in a PR can exhaust the CI runner's CPU/memory. Impact is bounded by the
ephemeral runner and lack of secrets, but it is a CI-availability lever.
**Fix:** reject source files above a documented cap (e.g. 32–64 MiB) before decoding, with
a clear error; optionally set `sharp` input limits.

### SEC-3 — `.gitignore` `data/` is unanchored (Low–Medium, pre-existing, epic-relevant)
`.gitignore:14` is `data/` (no leading slash), so it silently ignores **any** `data/`
directory: `assets/data/`, `src/assets/data/` and — directly relevant to epic
`2026-Q4-APEX-RALLY-APEX-02` — **`src/stage/data/` used by #APEX-4**. This is exactly the
"ship untracked assets" failure the ticket exists to prevent. Pre-existing on `main` (not
introduced by this PR), but the epic inherits it.
Reproduce: `git check-ignore -v src/stage/data/alpine.json` → matched by `data/`.
**Fix:** anchor it to `/data/`.

### SEC-4 — Manifest cache policy / hash verification (Informational)
Only hashed asset URLs are immutable — correct. `manifest.json` itself has no stated cache
policy and should be served revalidated (`no-cache`) so clients pick up new hashes; the
future runtime loader MAY verify bytes against `manifest.hash`. No action required here.

## Attack-surface checklist

- No secrets in code/history (diff scan clean); no `.env` committed.
- No path traversal: output paths are `join(outDir, KIND_DIR[kind], basename(url))` and
  `readdirSync` entries cannot contain `/`; `basename` strips any directory component.
- Symlinks in `assets/source/` are skipped (`isFile()` false) — no symlink escape.
- `assets/dist/` is gitignored and untracked; no runtime state committed.
- No CDN/remote code fetch; `ktx2-encoder` ships its wasm — no WASM/JS pulled at runtime.

## Residual risk

- CI only: a malicious upstream action tag or an oversized asset could affect a runner;
  no production secrets or data are in scope, so impact is limited to build integrity/
  availability.
- The `data/` gitignore trap can silently drop newly authored asset data across the epic
  until anchored.

## Evidence

- `bun audit` → no vulnerabilities (144 packages).
- `git check-ignore -v` on `src/stage/data/…`, `assets/data/…`, `src/assets/data/…`.
- Diff grep for `eval|child_process|fetch|http(s)://|secret|token|password`.
- Reviewer gate: typecheck clean, 84/84 tests, budget/load gate PASS, forced-breach exit 1.
