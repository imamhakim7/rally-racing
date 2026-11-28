# APEX-34 — fix: ship the encoded loops and wire the runtime (was silent)

Ticket: **#APEX-34** (bug, blocks **#APEX-17**) · branch
`feat/APEX-17-dynamic-car-and-environment-audio` · PR #21.

## Root cause

The mix model and Web Audio port were correct but never fed any audio:
`src/main.ts` called `createWebAudioPort(window, { maxOpponents })` with no
`assets`, and no code ever fetched/decoded the compiled asset manifest. The
pipeline also emitted a single raw `.wav` ambient loop (not the lead's encoded
engine/tyre/wind/rain loops), and the asset dist was never served or shipped.

## Changes

| Area | Change |
| --- | --- |
| `src/assets/optimize.ts` | `encodeMp3()` + `decodeWavPcm16()` (lamejs `@breezystack/lamejs`); deterministic PCM-WAV → MP3. |
| `src/assets/pipeline.ts` | audio branch encodes `.wav` → `.mp3`; clears `outDir` so stale hashed assets are not shipped. |
| `src/assets/sample.ts` | Deterministic **engine / tyres / wind / rain** 0.5 s loops (replaces `ambient-loop.wav`). |
| `src/audio/assets.ts` (new) | Pure runtime loader: `selectAudioBusAssets`, `resolveAudioUrl`, `loadAudioBusAssets` (fetch+decode, per-bus, failure-tolerant). |
| `src/audio/graph.ts` | `AudioPort.setAssets()` / `decode()`; `AudioContextLike.decodeAudioData`; sources start on unlock *or* when assets arrive later. |
| `src/main.ts` | Non-blocking manifest fetch → decode → `audio.setAssets()`; **surface** taken from the stage's surface spans at the car's arc-length. |
| `vite.config.ts` | `apex-asset-dist` plugin serves `assets/dist` at `/assets/*` (dev/preview) and copies it into `dist/assets/` on build. |
| `package.json` | `assets:dist` (no timestamped evidence); `predev`/`prebuild` run it; `@breezystack/lamejs` devDependency. |
| `src/assets/cli.ts` | `--evidence=0` so a plain build does not dirty the committed APEX-6 report. |

## Evidence 1 — pipeline now ships encoded loops within budget

`bun run assets:build` (full: `docs/evidence/APEX-17-assets-build.txt`):

```
ASSET BUDGET: PASS
  ok  engine                         4597 / 65536 B (audio)
  ok  rain                           4597 / 65536 B (audio)
  ok  tyres                          4597 / 65536 B (audio)
  ok  wind                           4597 / 65536 B (audio)
  total      24301 / 524288 B
  /assets/audio/engine.ab4f8d1b.mp3   (audio/mpeg)
  /assets/audio/tyres.1b345026.mp3    (audio/mpeg)
  /assets/audio/wind.6327af18.mp3     (audio/mpeg)
  /assets/audio/rain.a4996fe0.mp3     (audio/mpeg)
```

## Evidence 2 — live production bundle probe (before → after)

`bun run build && bun run preview`, chromium, click to unlock, hold ArrowUp.

| | before (#APEX-34) | after |
| --- | --- | --- |
| `stats.activeVoices` | 0 | **4** |
| `createBufferSource` calls | 0 | **4** |
| `decodeAudioData` calls | 0 | **4** |
| audio files fetched | `[]` | **engine/tyres/wind/rain `.mp3`** |
| page errors | none | none |

Live mix while driving:
```json
{ "engine": { "gain": 0.315, "pitch": 1.093 },
  "tyres":  { "gain": 0.051, "pitch": 0.946 },
  "ambience": { "wind": 0, "rain": 0 },
  "surface": "tarmac" }
```

## Evidence 3 — weather layers and surface respond live

Setting `window.apexStage.audio.env.rain01 = 1; env.wind01 = 1` in the running
page produced `ambience: { wind: 0.445, rain: 0.994 }` (wind also scales with
speed). The surface is now read from `physicsSurfaceAt(circuit, t)` at the car's
arc-length, so the tyre timbre follows the stage's surface spans.

## Gate

- `bun run typecheck` clean · `bun run test` **45 files / 323 tests green**
  (added `tests/audio-assets.test.ts`, the proving test) · `bun run build` clean.
- `tests/pipeline.test.ts` updated for the 6-asset sample set (4 encoded loops).
- Live: no page errors; `updateCostMs ≈ 0`.

## Verify

```bash
bun install
bun run assets:build     # 4 mp3 loops, budget PASS
bun run test             # 323 green
bun run build && bun run preview
# then load http://localhost:4173/, click, drive:
#   window.apexStage.audio.port.stats().activeVoices === 4
#   set window.apexStage.audio.env.rain01 = 1  -> rain layer enters
```
