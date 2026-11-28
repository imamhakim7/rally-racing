# APEX-17 — QA acceptance walkthrough (re-run after #APEX-34)

QA: qa (gate: qa_testing) — **re-verified after the #APEX-34 fix**.
Verdict on the re-run: **PASS**.

History: the first QA pass **FAILED** because the shipped build was silent
(no encoded loops, no runtime loader). That defect is fixed and re-proven below;
the original reproduction is kept in `docs/evidence/APEX-17-qa-repro.txt`.

Environment: `vitest 5.1.2` (node), production preview (`vite preview`) on
chromium 1255 (Playwright 1.65.1). Commands: `bun run typecheck`,
`bun run test`, `bun run assets:build`, `bun run build`, plus live probes.

## Acceptance criteria (re-run)

### AC1 Engine note tracks rpm and load — PASS
Model: engine pitch tracks `rpm01`, gain tracks `load01`
(`tests/audio-mix.test.ts`). Shipped: the engine loop is decoded and playing
(`activeVoices` includes engine) and the live mix shows a non-zero engine
gain/pitch that moves as the car drives.

### AC2 Tyre and surface audio changes measurably per surface — PASS
Model: distinct tyre gain+pitch per surface at equal slip. Shipped: `main.ts`
reads the surface from `physicsSurfaceAt(circuit, t)` at the car's arc-length
(same arc-distance as the pace notes), so the tyre bus timbre follows the stage's
surface spans; the tyre loop plays.

### AC3 Rain and wind layer with the weather preset — PASS (mix side)
The rain and wind loops are shipped and decoded, and the ambience layers respond
live: setting `window.apexStage.audio.env.rain01 = 1; wind01 = 1` produced
`ambience: { wind: 0.445, rain: 0.994 }`. The weather-preset *UI/toggle* is
#APEX-29's; the audio side consumes the injected environment state (dry default).

### AC4 3D attenuation follows car and chase camera — PASS
`attenuationGain`/`panForSource` unit-tested; the port positions HRTF panners and
attenuates per-opponent gain. Live: no errors with the listener wired from the
car.

### AC5 Audio unlocks after a gesture; mute/volume persist — PASS
Live: the bundle reports `portUnlocked: true` only after a click; a mute/volume
change round-trips `localStorage` across a reload
(`{"muted":true,"volume":0.33}` → reload → same).

### AC6 Total audio cost within the frame budget, no dropped frames — PASS
Live: `stats().updateCostMs ≈ 0`, `activeVoices = 4` (5 buses + opponent pool
bounded). Assets total 24 301 B, well under the 512 KiB cold-start budget.

## Regression

Full suite **45 files / 323 tests green** (the withheld proving test
`tests/audio-assets.test.ts` is now added and passes); typecheck clean;
production build succeeds; live probe error-free.

## Outcome

- #APEX-34 fixed on the same branch; #APEX-17 re-verified.
- Evidence: `docs/evidence/APEX-34-fix.md`, `-tests.txt`, `-typecheck.txt`,
  `-build.txt`, `-assets-build.txt`, `-qa-repro.txt`.
