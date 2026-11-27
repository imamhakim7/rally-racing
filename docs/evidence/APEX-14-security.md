# APEX-14 — Security review

Scope: `src/engine/capabilities.ts`, `src/engine/renderer.ts`, `src/ui/supportScreen.ts`,
`src/main.ts`, `index.html`, `scripts/smoke-browsers.mjs`. Reviewed against the OWASP Top
10 and the workspace engineering standards. Verdict: **PASS** — no new untrusted-input
sink, no new dependency, no secret, fail-closed boot.

## Threat model

| Surface | Trust | Handling |
| --- | --- | --- |
| `location.search` (`?forceUnsupported=1`) | Untrusted (URL) | Compared by strict equality to `"1"`. It selects a **constant** synthetic reason (`forcedUnsupportedAssessment()`); no part of the query string is echoed into the DOM or page. Cannot inject text, markup or a reason. |
| WebGL `getParameter` strings (`vendor`, `renderer`) | Untrusted (driver) | Captured into `GlCapabilities` for diagnostics only. **Never interpolated into the DOM** — grep confirms no render of `caps.vendor`/`caps.renderer` on any surface. |
| Boot exception text (`String(error)`) | Semi-trusted | Only reached when a supported browser fails to initialise; rendered via `textContent` (text node), never HTML. Not secret-bearing. |
| Capability labels (`assessment.missing`/`degraded`) | App-controlled constants | Set into `data-missing` via `setAttribute`; static strings. |

## Findings

- **A03 Injection (XSS): none.** The fallback screen is built exclusively with
  `document.createElement` + `element.textContent` / `setAttribute`. There is no
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, or
  `javascript:`/`data:` URL anywhere in the changed files (verified by grep). Static
  capability strings and error text are inert text nodes.
- **Anchors / link schemes: N/A.** The fallback adds no `<a>`/`href`; there is no
  client-supplied URL routed to an anchor (see engineering standards on `safeHref`).
- **A01 Broken Access Control / least privilege: N/A.** Client-only boot logic; no
  endpoint, no authorization decision, no principal. No new permissions requested.
- **A05/A06 Misconfiguration / vulnerable components: none.** **No new runtime
  dependency** was added; `playwright` was already a `devDependency`. No CDN import or
  versioned remote script is introduced, so the pinned-asset floor is unchanged.
- **A02/A08 Data integrity / insecure deserialisation: N/A.** No deserialisation, no
  `localStorage`, no cookies, no network fetch added at runtime.
- **A07 Auth failures / A09 logging: N/A.** No credentials, no auth, no PII, no secrets
  in code (grep clean). The diagnostics state lives on `window.apexStage` for local
  tooling only and is not transmitted.
- **Fail-closed boot (availability + integrity).** `tryCreateRenderer` never throws into
  the boot path: a missing/throwing WebGL2 context yields `{ ok: false }`, and an
  unexpected error during `bootGame` is caught and routed to the same actionable fallback.
  The failure mode is a clear screen, not an unhandled exception or a black canvas.

## Verification

- `grep -rn "innerHTML\|outerHTML\|eval(\|new Function\|dangerouslySet" src/ scripts/` → no matches.
- `grep -rniE "api[_-]?key|secret|password|token|PRIVATE" <changed files>` → no matches.
- `bun run typecheck` clean; `bun run test` 175/175 green; cross-engine smoke
  (`docs/evidence/APEX-14-smoke.json`) 0 uncaught page errors on all three engines.
