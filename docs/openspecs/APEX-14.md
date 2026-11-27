# APEX-14 — Browser/WebGL compatibility matrix and graceful fallback

Epic: `2026-Q4-APEX-RALLY-APEX-05` — Performance, Compatibility & Delivery.

Related: **#APEX-13** (frame-budget instrumentation / 60fps presets),
**#APEX-15** (CI/CD + static hosting — this ticket unblocks it), **#APEX-16**
(e2e/performance smoke in CI — this ticket adds the first browser smoke).
Supersedes the "fail fast" note in #APEX-1: the renderer no longer throws on a
missing context; the app degrades to an actionable screen.

## Problem

The game targets WebGL2 (three.js dropped WebGL1 in r163). Today
`createRenderer` calls `getWebGL2Context` and **throws** when no WebGL2 context
exists; `main.ts` lets that error escape, so an unsupported browser (old Safari,
IE-mode, a machine with GPU acceleration disabled, a headless/VM profile with no
WebGL) paints a **blank black canvas** with an exception in the console and no
explanation. There is also a single hard-coded render quality (pixel ratio 2,
PCFSoft shadows), so weak GPUs either stutter or fail with no way to run at a
reduced preset. Nothing documents which browsers are actually supported.

## Goal

At boot, **detect** WebGL2 and the extensions the renderer/assets need, **assess**
support, **degrade** the quality preset to the detected capability, and when the
browser cannot run the game show an **actionable unsupported-browser screen**
instead of a black canvas. Publish a **Supported browsers** matrix in the README
and prove boot behaviour across **Chromium, Firefox and WebKit** with a Playwright
smoke, including a forced-unsupported profile screenshot.

## Non-goals

- A WebGL1 fallback path — three.js r163+ has none; unsupported means unsupported.
- A settings UI to pick presets manually (presets are chosen from capability; a
  user override is a later ticket).
- Rewriting the render pipeline or stage materials for low-end GPUs (#APEX-13).
- Real-device/GPU lab; the smoke runs software-rendered browsers (SwiftShader /
  llvmpipe) as a compatibility proxy.

## Architecture (epic binding)

The epic requires "graceful WebGL fallback". This ticket implements capability
detection as a **pure, headless-testable** module and a DOM fallback screen, and
wires both into the existing boot path. It does not change the fixed-timestep
loop, scene lifecycle or `RendererHandle` port.

```
main.ts boot
  ├─ canvas? no  ─────────────────────────────► existing error
  ├─ getWebGL2Context(canvas)
  │     └─ null ──────────────► assessSupport() ─► mountSupportScreen()  (no throw)
  └─ context
        └─ detectCapabilities(context) ─► assessSupport() ─► resolveQualityPreset()
                                              └─ createRenderer(canvas, { quality })
                                                   └─ createEngine(...).start()
```

### Modules

| Module | Responsibility |
| --- | --- |
| `src/engine/capabilities.ts` | `detectCapabilities(gl)`, `assessSupport(caps, hints)`, `resolveQualityPreset(assessment)`, the required/optional extension tables and `SupportAssessment` / `QualityPreset` types. Pure — takes a (fake) GL context, no DOM. |
| `src/engine/renderer.ts` | `createRenderer` accepts a `QualityPreset` and applies it (pixel ratio, shadows, antialias). Export `tryCreateRenderer` returning a result instead of throwing. |
| `src/ui/supportScreen.ts` | `supportScreenContent(assessment)` (pure view-model) + `mountSupportScreen(host, assessment)` (DOM). Renders the actionable, accessible fallback. |
| `src/main.ts` | Boot: detect → assess → either mount fallback or create the renderer with the resolved preset; expose support state on `window.apexStage` for tooling. |
| `index.html` | Style + `#support` host for the fallback screen. |

### Interfaces

```ts
type SupportLevel = "full" | "reduced" | "unsupported";
type QualityPresetId = "low" | "medium" | "high";

interface GlCapabilities {
  webgl2: boolean;
  extensions: string[];      // names reported by getSupportedExtensions()
  maxTextureSize: number;
  vendor: string;            // unmasked when WEBGL_debug_renderer_info exists
  renderer: string;
}

interface DeviceHints {       // optional navigator signals, all optional
  deviceMemory?: number;      // navigator.deviceMemory (GB)
  hardwareConcurrency?: number;
}

interface SupportAssessment {
  level: SupportLevel;
  reason: string;              // one-line summary
  missing: string[];           // hard requirements that failed (level==="unsupported")
  degraded: string[];          // soft capabilities that are absent (level==="reduced")
  preset: QualityPresetId;
}

interface QualityPreset {
  id: QualityPresetId;
  maxPixelRatio: number;
  antialias: boolean;
  shadows: false | "basic" | "soft";  // basic=PCF, soft=PCFSoft
  shadowMapSize: number;
  anisotropy: number;
}

function detectCapabilities(gl: WebGL2RenderingContext | null): GlCapabilities;
function assessSupport(caps: GlCapabilities, hints?: DeviceHints): SupportAssessment;
function resolveQualityPreset(assessment: SupportAssessment): QualityPreset;
```

### Capability policy

Hard requirement (else `unsupported`):

1. **WebGL2** context.

Soft capabilities (absent ⇒ `reduced`, game still runs):

- **A compressed-texture format** (`WEBGL_compressed_texture_etc` / `_s3tc` /
  `_astc` / `EXT_texture_compression_bptc`) — required to decode the KTX2 assets
  from #APEX-6; without one, textured stages cannot upload their textures.
- **`EXT_color_buffer_float`** — float render targets.
- **`EXT_texture_filter_anisotropic`** — sharp ground textures; its absence only
  lowers the preset.

Preset selection:

- `unsupported` → `low` (never used; a safe default).
- `reduced` → `medium`.
- `full` + weak device (`deviceMemory <= 2` **or** `hardwareConcurrency <= 2`) →
  `medium`; very weak (`<= 1` on either) → `low`.
- otherwise `high`.

### Invariants

1. `createRenderer` never throws on a missing WebGL2 context when called through
   `tryCreateRenderer`; `main.ts` boot never throws for an unsupported browser.
2. `detectCapabilities(null)` never throws and returns `webgl2:false` with empty
   capability fields.
3. `assessSupport` is deterministic for the same `caps`+`hints`; `level` is
   `unsupported` **iff** a hard requirement is missing.
4. `resolveQualityPreset` is monotonic in capability: weaker capability never
   yields a *higher* preset (`high ≥ medium ≥ low`).
5. The fallback screen is actionable: it states the problem, lists the missing
   capability, and gives concrete remediation steps; it carries
   `data-support="unsupported"` and `role="alert"` for tooling/a11y.
6. The supported path tags the canvas/state with `data-support="supported|reduced"`.
7. No user/URL input is written into the fallback DOM without escaping (content
   is static capability strings; the forced-unsupported hook takes no free text).

### Edge cases

- Canvas/context creation throws (some browsers throw instead of returning null):
  boot catches and shows the fallback.
- `getSupportedExtensions()` returns `null` (context lost) — treated as empty.
- `navigator.deviceMemory` / `hardwareConcurrency` undefined → not treated as
  weak (absence of a signal is not evidence of a weak device).
- Context lost after boot: out of scope (existing renderer behaviour).
- Forced-unsupported profile (`?forceUnsupported=1`) for deterministic fallback
  evidence/tests; it reports a synthetic "WebGL2 disabled by profile" reason.

## Acceptance criteria (Given/When/Then)

- **AC1 — detect at boot.** Given a WebGL2 context, When the app boots, Then
  `detectCapabilities` reports `webgl2:true` and the required/optional extensions
  it exposes; Given no WebGL2 context, Then it reports `webgl2:false` without
  throwing.
- **AC2 — graceful fallback, never a black canvas.** Given a browser/profile with
  no WebGL2, When the page loads, Then boot does **not** throw, the game loop does
  **not** start, and an actionable unsupported-browser screen is mounted
  (`data-support="unsupported"`), naming the missing capability and remediation.
- **AC3 — quality degrades by capability.** Given `full` capability on a strong
  device, Then the preset is `high` (pixel ratio 2, soft shadows); Given missing
  soft capabilities or a weak device, Then the preset degrades to `medium`/`low`
  and the renderer is created with that preset.
- **AC4 — supported boot is tagged and renders.** Given a supported browser, When
  the app boots, Then the fallback is absent, the loop starts, and support state is
  exposed (`data-support="supported"` / `window.apexStage.support`).
- **AC5 — documented matrix.** The README contains a "Supported browsers" table
  mapping the three engines (Chromium/Firefox/WebKit) to support level, the WebGL2
  requirement, presets and the fallback behaviour.
- **AC6 — smoke across engines.** A Playwright smoke boots the built app in
  Chromium, Firefox and WebKit and asserts, per engine, exactly one valid outcome —
  rendered **or** graceful fallback — with **zero** uncaught page errors; it writes
  machine-readable results and a screenshot of the fallback on a forced-unsupported
  profile.

## How to test

- **Unit (Vitest, headless):** `tests/capabilities.test.ts` — fake GL contexts
  exercising every branch: full / reduced (each missing soft cap) / unsupported,
  weak-device hints, monotonic presets, null context, absent extension list.
- **Unit:** `tests/support-screen.test.ts` — `supportScreenContent` for the
  unsupported and reduced assessments (title, missing list, remediation steps,
  deterministic output).
- **Unit:** `tests/renderer-preset.test.ts` — `resolveQualityPreset` → renderer
  option mapping and `tryCreateRenderer` with a canvas stub whose `getContext`
  returns null (ok:false) and a fake context (ok:true).
- **Browser evidence:** `bun run build && xvfb-run -a bun scripts/smoke-browsers.mjs`
  — boots the built app in Chromium (SwiftShader), Firefox (llvmpipe under Xvfb)
  and WebKit; writes `docs/evidence/APEX-14-smoke.json` and
  `docs/evidence/APEX-14-fallback.png` (forced-unsupported profile).
- **Gates:** `bun run typecheck` and `bun run test` green; evidence attached.

## Evidence plan

- `docs/evidence/APEX-14-tests.txt` — full Vitest run.
- `docs/evidence/APEX-14-typecheck.txt`, `APEX-14-build.txt`.
- `docs/evidence/APEX-14-smoke.json` — per-engine results + outcomes.
- `docs/evidence/APEX-14-fallback.png` — graceful-fallback screenshot.
- `docs/evidence/APEX-14-security.md` — threat model / OWASP pass.
- README "Supported browsers" table.
