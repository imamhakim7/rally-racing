# APEX-17 — Dynamic car and environment audio mix

Epic: `2026-Q4-APEX-RALLY-APEX-06` — Audio & Co-driver
(architecture: `docs/architecture/2026-Q4-APEX-RALLY-APEX-06.md`).
Consumes: **#APEX-2** (`src/physics` car state + `SurfaceId`), the **#APEX-4**
`SampledSpline`/`StageWorld` world, and the engine's fixed-timestep loop.
Parallel sibling: **#APEX-18** (co-driver pace notes) — neither imports the other;
the composition root (`src/main.ts`) owns both.

## Problem

Rally feel is audio-led: the engine note carries speed, tyre scrub carries grip,
and surface changes are heard before they are seen. The build has no audio graph,
no mixing and no audio asset pipeline, so the scene is silent. There is also
nothing that respects the browser's autoplay rules or persists a mute/volume
choice.

## Goal

A dynamic, spatialised audio mix driven by car state (`rpm`, `load`, `slip`,
`surface`, `impact`) and environment (`wind`, `rain`) that:

- stays inside the frame budget (bounded per-frame work, no per-frame allocation),
- unlocks only after a user gesture (autoplay policy),
- persists a global mute/volume across reloads,
- degrades cleanly to silence on a device/platform with no `AudioContext`.

## Non-goals

- **Weather *simulation*** — this ticket *consumes* an environment state
  (`wind01`, `rain01`) supplied by the composition root. The weather preset UI and
  sky/rain rendering belong to **#APEX-29** (`docs/openspecs/APEX-29`). Until it
  lands the root supplies a dry default (`wind: 0, rain: 0`).
- **A settings *screen*** — **#APEX-11** owns the menus. This ticket defines the
  `AudioSettings` shape and a persistence **port** (`AudioSettingsStore`) with a
  `localStorage` default; #APEX-11 mounts the UI over it. No DOM is added here.
- **Recording or shipping audio files** — the loops are **generated
  deterministically** by `src/assets/sample.ts` and **encoded to MP3** by the
  pipeline (`encodeMp3`), so no third-party/CC0 binaries need committing. The
  port still accepts any caller-supplied `AudioBufferLike`.
- **A voice / pace-note bus** — #APEX-18 owns speech.
- **Doppler / convolution reverb** — out of scope; attenuation is inverse-distance.

## Architecture (epic binding)

Epic principle 2 ("pure core, port at the edge") and invariant 4 ("no DOM/Web Audio
in the core") apply directly. `src/audio/` is split so the *decisions* (gains,
pitch, attenuation, persistence) are pure and headless, and the Web Audio API sits
behind one structural port.

```
car state ──▶ computeAudioMix(car, env) ──▶ AudioMix ──▶ AudioPort (Web Audio)
                   (pure)                       │              ▲
environment ───────┘                             │              │ update()
                                                 │              │
player/opponent world pos ──▶ attenuationGain ──┘     listener (chase camera)
player/opponent world pos ──▶ panForSource ──────────▶

AudioSettings ◀── AudioSettingsStore (localStorage port) ◀── #APEX-11 UI
```

### Modules (`src/audio/`)

| Module | Responsibility |
| --- | --- |
| `mix-model.ts` | Pure `computeAudioMix(car, env, opts)` + the `AudioMix`/`CarAudioState`/`EnvironmentAudioState` types and the `SURFACE_AUDIO` timbre table. Deterministic; no DOM. |
| `spatial.ts` | Pure `attenuationGain`, `panForSource`, `listenerFromCar` — inverse-distance attenuation and stereo pan for the player's car and the HRTF-panned opponents. |
| `settings.ts` | `AudioSettings` shape, `loadAudioSettings`/`saveAudioSettings` (clamped, never throws), `AudioSettingsStore` port with memory + `localStorage` implementations, and `setAudioMuted`/`setAudioVolume` helpers. |
| `assets.ts` | Pure runtime loader: `selectAudioBusAssets` (manifest → buses), `resolveAudioUrl` (sub-path safe), `loadAudioBusAssets` (fetch + decode, per-bus, failure-tolerant). Platform access is injected. |
| `graph.ts` | `createWebAudioPort(source, opts)` — the Web Audio port: a master gain + one gain per bus (engine, tyres, ambience[wind,rain], impacts), sampled loops (`loop=true`) pitched by `playbackRate`, an HRTF panner per opponent, gesture unlock/source-on-asset-arrival, and `stats()`. `createNullAudioPort()` is the safe no-op. |
| `index.ts` | Barrel: re-export the public audio API. |

### Mix model

- **Engine** — `pitch = idleRate + rpm01 * rpmSpan`; `gain = ENGINE_BASE *
  (BASE_LOAD + (1 - BASE_LOAD) * load01)`. Tracks rpm (pitch) *and* load (gain).
- **Tyres** — per-surface timbre from `SURFACE_AUDIO`: `gain` and `pitch` differ
  measurably between tarmac/gravel/mud/ice at the same slip, so a surface change is
  audible before it is seen. Tyre energy scales with slip and a little with speed.
- **Ambience** — `wind = wind01 * (WIND_ROLL + (1 - WIND_ROLL) * speed01)` so wind
  grows with speed; `rain = rain01`. Both are independent layers over the mix.
- **Impacts** — a decaying `impact01` from the caller drives a one-shot-scaled gain.
- All outputs are clamped to `[0, 1]` (gains) and a sane pitch range; non-finite
  inputs clamp to the neutral value and never throw.

### Spatialisation

`attenuationGain(distance, { refDistance, maxDistance, rolloff })` is inverse
distance beyond `refDistance`, rolling to `0` at `maxDistance`. `panForSource`
projects the source onto the listener's right vector to a `[-1, 1]` pan; the player
car uses the chase-camera listener, opponents use their own positions (fed to the
port's HRTF panners).

### Frame budget

Per-frame work is O(1) buses + O(active opponents): a bounded number of
`AudioParam.value` writes. `AudioMixModel` (optional smoothing wrapper) reuses one
`AudioMix` object and does not allocate per step. `stats()` reports
`activeVoices`, `buses`, `updates` and `updateCostMs` (measured with
`performance.now` where available) for the stats overlay.

### Graceful degradation

No `AudioContext`/`webkitAudioContext` ⇒ `createNullAudioPort()`; `available ===
false`, `unlock`/`update` are no-ops, `stats()` reports zero voices. No buffers ⇒
the graph builds but sources are not started. No settings store ⇒
`loadAudioSettings()` returns defaults. The race is fully playable and silent.

### Interfaces

```ts
type AudioBusId = "engine" | "tyres" | "ambience" | "impacts";

interface CarAudioState {
  rpm01: number; load01: number; speed01: number;
  slip01: number; surface: SurfaceId; impact01: number;
}
interface EnvironmentAudioState { wind01: number; rain01: number; }
interface BusMix { gain: number; pitch: number; }
interface AudioMix {
  engine: BusMix; tyres: BusMix;
  ambience: { wind: number; rain: number };
  impacts: { gain: number; pitch: number };
  surface: SurfaceId;
}
function computeAudioMix(car, env, opts?): AudioMix;

interface ListenerState { x: number; y: number; z: number; yaw: number; }
function attenuationGain(distance: number, opts?): number;
function panForSource(source, listener, opts?): number;
function listenerFromCar(car, camera): ListenerState;

interface AudioSettings { muted: boolean; volume: number; }
interface AudioSettingsStore { read(): Partial<AudioSettings> | null; write(s: AudioSettings): void; }
function loadAudioSettings(store?): AudioSettings;
function saveAudioSettings(store, settings): AudioSettings;

interface AudioPort {
  readonly available: boolean;
  readonly unlocked: boolean;
  unlock(): void;
  setAssets(assets: AudioBusAssets): void;
  decode(data: ArrayBuffer): Promise<AudioBufferLike | null>;
  setSettings(settings: AudioSettings): void;
  setOpponents(sources: readonly SpatialSource[]): void;
  update(mix: AudioMix, listener: ListenerState): void;
  stats(): AudioStats;
  dispose(): void;
}
function createWebAudioPort(source?, opts?): AudioPort;
function createNullAudioPort(): AudioPort;

// #APEX-17 runtime loader (src/audio/assets.ts)
function selectAudioBusAssets(manifest): SelectedAudioAsset[];
function resolveAudioUrl(url, base): string;
function loadAudioBusAssets(manifest, decode, opts?): Promise<AudioBusAssets>;
```

### Invariants

1. `computeAudioMix` is pure: identical `(car, env)` ⇒ deeply equal mix. No
   `Math.random`, no `Date.now`.
2. Every gain is in `[0, 1]`; every pitch is finite and positive; non-finite input
   never throws.
3. Surface change at constant slip ⇒ a measurably different tyre `gain` **and**
   `pitch` (the `SURFACE_AUDIO` rows are distinct).
4. `attenuationGain` is `1` inside `refDistance`, strictly decreasing, `0` at
   `maxDistance`; `panForSource ∈ [-1, 1]`.
5. `loadAudioSettings` clamps `volume ∈ [0,1]`, defaults `muted`, and never throws
   on a malformed/absent store.
6. `createNullAudioPort().available === false`; `unlock`/`update`/`dispose` never
   throw. `createWebAudioPort(null)` returns the null port.
7. The port never starts a source before `unlock()` (autoplay policy); `unlock` is
   idempotent.

### Edge cases

- Absent/throwing `AudioContext` ⇒ null port, silent, no error.
- Source overrides provided (sample buffers, gains) ⇒ used; missing ⇒ silent graph.
- Degenerate car/env numbers (`NaN`, `±Infinity`, negatives) ⇒ clamped defaults.
- `unlock()` called from many gestures ⇒ resumed once.
- `dispose()` then `update()` ⇒ no throw, no work.
- Settings JSON malformed / `localStorage` disabled ⇒ defaults, no throw.

## Acceptance criteria (Given/When/Then)

- **AC1 Engine note tracks rpm and load** — Given a car state, When `rpm01` rises
  Then engine `pitch` rises; When `load01` rises Then engine `gain` rises.
- **AC2 Tyre and surface audio change measurably per surface** — Given identical
  `slip01`, When `surface` changes tarmac→gravel, Then tyre `gain` **and** `pitch`
  both change (and each surface row is distinct).
- **AC3 Rain and wind layer with the weather preset** — Given `wind01`/`rain01`
  from the environment state, When they rise Then the ambience wind/rain layers
  rise and are independent; wind also grows with `speed01`.
- **AC4 3D attenuation follows the car and chase camera** — Given a listener and a
  source, When distance/offset grows Then `attenuationGain` falls and
  `panForSource` moves toward the far side; opponents are fed to the port's panners.
- **AC5 Unlock after a gesture; mute/volume persist** — Given audio is locked,
  Then sources do not start until `unlock()`; Given settings are saved to a store,
  When reloaded Then mute/volume are restored (clamped).
- **AC6 In budget, no dropped frames** — Given a running race, Then per-frame audio
  work is a bounded number of param writes, `stats().activeVoices` is bounded by
  the bus+opponent count, and no per-frame allocation proportional to the stage.

## How to test

- `bun run test` — `tests/audio-mix.test.ts` (AC1–AC3 + invariants/edges),
  `tests/audio-spatial.test.ts` (AC4), `tests/audio-settings.test.ts` (AC5),
  `tests/audio-port.test.ts` (AC5 unlock ordering + AC6 budget + degradation), all
  headless with fakes (no `AudioContext`, no GPU).
- `bun run typecheck` — clean.
- `bun run build` — production bundle succeeds.
- Manual: `bun run dev`; click to unlock audio, drive tarmac then gravel and hear
  the tyre timbre change; raise rain/wind via the environment state and hear the
  layers; mute, reload, confirm it stays muted; read `window.apexStage.audio.stats()`
  (and the stats overlay when present) for the audio cost.

## Evidence

- `docs/evidence/APEX-17-tests.txt` — Vitest green incl. the new suites.
- `docs/evidence/APEX-17-typecheck.txt` — `tsc --noEmit` clean.
- `docs/evidence/APEX-17-build.txt` — `vite build` succeeds.
- `docs/evidence/APEX-17-assets-build.txt` — pipeline ships 4 MP3 loops within budget.
- `docs/evidence/APEX-34-fix.md` — the silent-build fix + live after-probe.
- `docs/evidence/APEX-17-review.md` — code review notes.
- `docs/evidence/APEX-17-security.md` / `-security-audit.txt` — security review.
- `docs/evidence/APEX-17-qa.md` — acceptance walkthrough against AC1–AC6.
