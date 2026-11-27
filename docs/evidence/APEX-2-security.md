# APEX-2 — Security gate evidence

Ticket: **#APEX-2** · Branch: `feat/APEX-2-arcade-rally-vehicle-handling-with` · PR: imamhakim7/rally-racing#3
Seat: `@security` · Verdict: **PASS — no blocking findings**

## 1. Scope & trust boundaries

Apex Rally is a **client-side browser game** (three.js WebGL2). This change adds the vehicle
physics, keyboard input, a debug overlay and a drivable test scene. There is **no backend,
no authentication/authorization, no persistence, no PII and no LLM/AI feature**.

| # | Trust boundary | Untrusted data | Sinks |
| - | - | - | - |
| 1 | Browser keyboard → game loop | key codes | mapped to a fixed numeric `VehicleInput`; no DOM/JS execution sink |
| 2 | Dev-only Node static server (`scripts/screenshot.mjs`, loopback + ephemeral port) → `dist/` filesystem | HTTP request path | `stat`/`readFile`, confined to `dist/` |
| 3 | npm supply chain → build/runtime | package code | `three` only ships to users; lockfile pinned with integrity hashes |
| 4 | Build artifact (`dist/`) → static hosting | none at runtime | static HTML/JS; no network calls, no `eval` |

## 2. STRIDE

- **Spoofing** — N/A (no identities).
- **Tampering** — client-side state is user-controllable by design. This ticket has no score or
  race timing (that is #APEX-3); nothing trusts client results yet. **Residual:** when timing/
  leaderboards arrive, results must be server-verified, not client-authoritative.
- **Repudiation** — N/A.
- **Information disclosure** — no secrets/PII; static server is confined to `dist/`.
- **Denial of service** — physics is O(1) per fixed step; the #APEX-1 loop clamps frame delta;
  no unbounded input. Static server reads small local files on loopback only.
- **Elevation of privilege** — N/A (no server, no roles).

## 3. OWASP Top 10 (2021)

| Risk | Result |
| - | - |
| A01 Broken Access Control | N/A for the app; dev server path traversal mitigated and probed (below). |
| A02 Cryptographic Failures | N/A (no crypto). |
| A03 Injection | No SQL/OS/DOM injection. No `innerHTML`/`eval`; overlay uses `textContent`/`setAttribute` with typed values. |
| A04 Insecure Design | Single-player arcade game; client-authoritative is acceptable. Forward note in §2. |
| A05 Security Misconfiguration | Production artifact is static; devDeps are tooling only. |
| A06 Vulnerable Components | `bun audit`: **No vulnerabilities found (94 packages)**. |
| A07 Identification/Auth | N/A. |
| A08 Software/Data Integrity | `bun.lock` committed with integrity hashes; no remote script injection. |
| A09 Logging/Monitoring | N/A. |
| A10 SSRF | N/A (no server-side fetch). |

**OWASP LLM Top 10** — not applicable (no LLM/AI features).

## 4. Checks performed

```
$ git grep -nE "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=]|Bearer [A-Za-z0-9._-]{20,})" -- . ':!bun.lock'
NO SECRETS FOUND
$ git ls-files | grep -E "\.env|secret|credential"
(no env/secret files tracked; .gitignore covers .env, board DBs, logs)

$ grep -rnE "dangerouslySet|innerHTML|outerHTML|eval\(|new Function|document\.write|insertAdjacentHTML|localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket|process\.env|import\.meta\.env" src/ index.html scripts/
NO RISKY PATTERNS FOUND

$ grep -rnE "https?://|TextureLoader|FileLoader|GLTFLoader|\.src\s*=" src/
none   # no external resource loading
$ grep -rnE "postMessage|Worker|indexedDB|localStorage|document\.cookie" src/
none

$ bun audit
No vulnerabilities found (checked 94 packages)

$ tsc --noEmit                       -> clean
$ vitest run                         -> 53/53 pass
$ vite build                         -> success
```

Path-confinement probe of the dev static server (normalize + `distRoot + sep` prefix check):

```
"/etc/passwd"                 ALLOW  <dist>/etc/passwd   (inside dist; file absent -> 404, never the real /etc/passwd)
"../package.json"             DENY   .../APEX-2/package.json
"..%2f..%2fpackage.json"      DENY   .../wt/package.json
"%2e%2e%2f%2e%2e%2fetc%2fpasswd" DENY .../wt/etc/passwd
"/../../etc/passwd"           DENY   .../wt/etc/passwd
"a/../../package.json"        DENY   .../APEX-2/package.json
```

All `..` escapes are rejected; absolute paths are re-rooted under `dist/`.

## 5. Dependency versions (lockfile-pinned)

`three@0.187.0` (only runtime dep) · `vite@7.3.8` · `vitest@5.1.2` · `esbuild@0.28.2` ·
`rollup@4.68.8` · `playwright@1.65.1` · `typescript@5.9.3` · `nanoid@3.3.20` (transitive).
`bun audit` clean at these versions; none ship to the browser except `three`.

## 6. Findings

| Sev | Finding | Decision |
| - | - | - |
| Critical | none | — |
| High | none | — |
| Medium | none exploitable in the delivered client-only artifact | — |
| Low (L1) | Race timing/scoring will be client-authoritative when #APEX-3 lands; results must be server-verified then. Not a defect in this change. | Residual, tracked forward |
| Low (L2) | Dev static server has a benign TOCTOU (`stat` then `readFile`) and follows symlinks; loopback-only, trusted `dist/` | Accepted |
| Info | `index.html` ships no CSP; a strict CSP is trivial to add at hosting time (no inline scripts) | Optional hardening |

## 7. Verdict

**PASS.** No Critical/High/Medium issues; no secrets, injection sinks, external loads or PII.
Residual risk (client-authoritative future scoring; dev-server-only TOCTOU) is explicitly
accepted and documented above. No blocking bug ticket required.
