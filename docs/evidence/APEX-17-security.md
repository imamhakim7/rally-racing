# APEX-17 — security review (gate: security_testing)

Reviewer: security
Verdict: **pass**

Threat model for this change: a client-only Web Audio mixer driven by numeric
simulation state, with a `localStorage`-backed settings port. No network, no user
input parsing beyond numbers, no server surface.

## OWASP / CWE checklist

| Concern | Finding |
| --- | --- |
| Injection (CWE-79/89) | No HTML/eval/SQL sink. All output is `AudioParam.value` writes. Settings are JSON-serialised with `JSON.stringify`. Pass. |
| Untrusted deserialisation (CWE-502) | `createLocalStorageSettingsStore.read` wraps `JSON.parse` in try/catch, rejects non-objects, and `normalizeAudioSettings` clamps/coerces every field. Malformed JSON ⇒ defaults. Pass. |
| Prototype pollution (CWE-1321) | Parsed settings are read field-by-field (`muted`, `volume`) into a fresh object; no merge into prototypes. Pass. |
| Denial of service (CWE-400) | Bounded opponent voice pool (`maxOpponents`, default 4), bounded buses (5), fixed-size buffers supplied by the caller. No unbounded loops. Pass. |
| Secrets / data exposure | Nothing sensitive stored or logged; settings are `{muted, volume}` only. Pass. |
| XSS via settings UI (#APEX-11) | Out of scope here; the port exposes only typed values. Pass. |
| Autoplay / permission | Audio starts only after a user gesture; no auto-play-bypass. Pass. |
| Resource lifetime | `dispose()` stops each source, disconnects, and closes the context; `main.ts` removes the gesture listeners on HMR dispose. Pass. |

## Residual risk

- Low: the Web Audio backend can throw in the wild (no audio device). Every port
  call is guarded (`try/catch` around `resume`, `start`, `stop`, `close`); a
  throwing backend must never break the race loop. Verified by tests.

## Knowledge feedback

No recurring defect class revealed. No `docs/security/lessons.md` entry required.

## Evidence

- `docs/evidence/APEX-17-security-audit.txt` — grep-based secret/sink audit.
- `docs/evidence/APEX-17-tests.txt` — includes the malformed/blocked-storage and
  throwing-backend cases.
