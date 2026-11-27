# APEX-10 — Security review (race HUD)

Scope: the new/changed surface of #APEX-10 — `src/race/hud.ts`, `hud-model.ts`,
`telemetry.ts`, `results.ts`, `race.ts`, `stage.ts`, `types.ts`, `main.ts`, and
`scripts/screenshot-hud.mjs`.

## Threat model (STRIDE, this change)

| Asset | Threat | Control |
| --- | --- | --- |
| DOM overlay | **Tampering / XSS** via rendered strings | All dynamic text is written with `textContent` / `document.createElement`. **No `innerHTML`/`insertAdjacentHTML`/`eval` anywhere** in the overlay. Verified: `grep -rn "innerHTML\|insertAdjacentHTML\|eval(" src/race`. |
| Minimap SVG | Attribute injection through path data | The SVG `viewBox` is static; the `d` attribute comes only from `toSvgPath()` over resolved numeric points (our code), never raw stage JSON strings. |
| Stage data | Malformed reference pace → bad render / NaN | `defineStage` validates `referenceSplits`: known gate ids, finite/non-negative, non-decreasing cumulative times. `formatTime`/`formatSpeed`/`formatDelta` clamp non-finite/negative input so a bad value cannot produce NaN markup. |
| Telemetry port | Untrusted speed → NaN text | `formatSpeed` clamps; `buildSrKey` guards non-finite speed. |
| Keyboard | Scroll-jacking | Only `Space`/arrow keys are `preventDefault`ed (pre-existing input harness); no capture/eval. |
| Network / data egress | Exfiltration | **None.** The HUD adds no fetch/WebSocket/analytics; telemetry is an in-process `Vehicle` simulation. No new dependencies. |
| Motion sensitivity | Vestibular harm | `@media (prefers-reduced-motion: reduce)` disables the split flash and transitions. |
| Screen readers | Inaccessible state | A polite, atomic `role="status"` live region summarises race state; decorative SVG is `aria-hidden`. |

## OWASP Top-10 (relevant) check

- **A03 Injection** — no string-built HTML; `textContent` only. PASS.
- **A05 Security misconfiguration** — no config/secrets touched; no `dangerouslySetInnerHTML` equivalent. PASS.
- **A08 Software/data integrity** — stage reference data validated at load. PASS.
- **A09 Logging/monitoring** — no secrets in new logs; HUD holds no credentials (pre-existing `window.apexStage` debug handle is unchanged by this ticket). N/A.

## Secrets / credentials

No secrets introduced. Review-verdict bodies are handled by the platform's existing
sanitizer (unchanged). No `.env` changes.

## Result

PASS — no blocking findings. One informational note: the interim keyboard telemetry
harness (like #APEX-3's gate harness) is dev-only scaffolding to be replaced when the
in-world vehicle lands (#APEX-16); it adds no attack surface (no network, no storage).

Commands run: `bunx tsc --noEmit` (clean), `bun run test` (182 pass),
`bun run build` (success); DOM sink grep above.

## Re-run verification — PR #8 (`feat/APEX-10-race-hud-speed-time-splits` @ `7c3cfe3`)

Independently re-derived (not trusted from the prior pass) against the actual PR head.

- **Diff scope:** 23 files, +1716/−89; `git diff f47165c..7c3cfe3`. No lockfile/`package.json` change → **zero new dependencies**.
- **Sinks (independent grep):** `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval(|new Function|dangerously*` across `src/` → **none**.
- **Egress/storage:** `fetch|XHR|WebSocket|sendBeacon|import(|localStorage|sessionStorage|document.cookie|indexedDB` across `src/` → **none**.
- **Secrets:** `api_key|secret|password|token|bearer` across `src/` + `scripts/` → **none**.
- **Dependency CVEs:** `bun audit` → *No vulnerabilities found (checked 144 packages)* (`APEX-10-security-audit.txt`).
- **Gates:** `bunx tsc --noEmit` clean; `bun run test` 26 files / 182 pass.
- **Dev tooling:** `scripts/screenshot-hud.mjs` is a local evidence server, not shipped; its static handler normalises and confines paths to `dist/` (`startsWith(distRoot + sep)` → 403 otherwise). No traversal.

### Findings

None Critical/High/Medium. **PASS.**

### Residual risk (documented, not blocking)

1. `window.apexStage` debug global (`src/main.ts`) is **pre-existing** (present on base `f47165c`) and exposes internal objects to same-page scripts; low value without an XSS sink, which does not exist.
2. `index.html` has no CSP. The HUD injects one `<style>` element and inline styles, so a future CSP would need `style-src 'unsafe-inline'` (or nonces). Recommend a separate defense-in-depth hardening ticket; no exploitable issue in this change.
3. The interim keyboard telemetry harness is dev scaffolding pending the in-world vehicle (#APEX-16); no network/storage surface.

Verdict: **security PASS at the security gate; no bug ticket required.**

