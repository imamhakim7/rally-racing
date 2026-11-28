# APEX-18 — security review

Reviewer: seat-security
Scope: co-driver pace notes + optional speech synthesis introduced by APEX-18.

## Verdict: PASS — no blocking findings

## Threat review

| Area | Assessment |
| --- | --- |
| **Injection / XSS** | The HUD writes note strings with `textContent` / `createElement`, never `innerHTML`. Stage-derived `checkpoint.name` is only ever a text node. No HTML is parsed from stage data. |
| **Untrusted input surface** | Note text derives from the in-repo, schema-validated stage files (`validateStage`), not user input or the network. `speak()` ignores empty/whitespace text. |
| **Speech synthesis misuse** | Only the computed `note.call` (`"Right 3"`, `"Hairpin left"`) is spoken — a bounded phrase, not free-form data. Errors from the speech backend are caught; a missing/blocked API yields a no-op voice. |
| **Third-party / supply chain** | No new dependencies. No `eval`, `Function`, dynamic import of remote code, or `postMessage`. |
| **Network / data exfil** | No `fetch`/`WebSocket`/beacon. The module is entirely local. |
| **Resource exhaustion** | No unbounded loops. `buildPaceNotes` is O(samples); the scheduler is O(log n + notes-in-window); `nearestDistanceOnSpline` is O(samples). All clamps guard non-finite input. |
| **Global exposure** | `window.apexStage.pace` exposes `{ tracker, voice }` for tooling/evidence, consistent with the pre-existing `window.apexStage` / `window.apexRace`. Read/write of in-memory game state only; no credentials, tokens or PII. |
| **Accessibility / abuse** | Voice is optional, defaults to on only when the platform supports it, and can be toggled off (button or `V`); the visual notes and live region carry the same information without audio. |
| **Autoplay / policy** | Speech begins after the player's "Start stage" gesture; no autoplay on load. |

## Secrets

None handled. `bun run test` / `build` output contains no secrets.

## Evidence

- `docs/evidence/APEX-18-security-audit.txt` — grep audit of the diff for risky
  patterns (`innerHTML`, `eval`, `Function(`, `fetch`, `postMessage`,
  `Math.random`, `Date.now`, `localStorage`).
- `docs/evidence/APEX-18-tests.txt`, `-typecheck.txt`, `-build.txt`.
