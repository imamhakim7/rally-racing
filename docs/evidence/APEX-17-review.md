# APEX-17 — code review

Reviewer: reviewer (gate: code_review) · re-reviewed after the rebase onto `origin/main` (`d48abf4`).
Verdict: **approve**

## What was reviewed

`git diff origin/main...HEAD` (40 files, +3131/−54): the dynamic audio mix, its
asset-pipeline encoding, the runtime loader, and the composition-root wiring.

- `src/audio/mix-model.ts` — pure mix decisions (`computeAudioMix`, `AudioMixer`, `SURFACE_AUDIO`).
- `src/audio/spatial.ts` — pure attenuation/pan (`attenuationGain`, `panForSource`, `listenerFromCar`).
- `src/audio/settings.ts` — `AudioSettings` + `AudioSettingsStore` port (memory + localStorage).
- `src/audio/assets.ts` — runtime loader (`selectAudioBusAssets`, `resolveAudioUrl`, `loadAudioBusAssets`).
- `src/audio/graph.ts` — the Web Audio port (`createWebAudioPort`/`createNullAudioPort`, `setAssets`, `decode`).
- `src/assets/{optimize,pipeline,sample,cli}.ts` — PCM WAV → MP3 (lamejs), stale-output clearing, bus loops.
- `vite.config.ts` — `apex-asset-dist` plugin (serve `/assets/*`, copy into `dist/assets/`).
- `src/main.ts` — wiring: settings, gesture unlock, manifest load/decode/`setAssets`, per-tick mix + surface, dispose.
- Tests — `tests/audio-{mix,spatial,settings,port,assets}.test.ts`, `tests/pipeline.test.ts`.

## Tests actually exercise the change (read first)

- `audio-port.test.ts` builds the graph with a **fake `AudioContext`** and asserts:
  no sources before `unlock()`; `unlock` resumes once and starts all loops; bus
  gains/pitch written from the mix; mute→0; near opponent louder than far;
  dispose stops sources — i.e. the real port logic, not mocks of itself.
- `audio-assets.test.ts` runs the **real pipeline** and asserts the shipped loops are
  encoded (`audio/mpeg`), named per bus, and within the 64 KiB/512 KiB budget; plus
  loader selection, sub-path URL resolution and per-bus failure tolerance.
- `audio-mix.test.ts` / `audio-spatial.test.ts` / `audio-settings.test.ts` cover the
  ACs directly (rpm/load, per-surface timbre, wind/rain, attenuation/pan,
  persistence, malformed input) and the `AudioMixer` object-reuse invariant.
- `pipeline.test.ts` updated to the 6-asset sample set.

## Findings

1. **Epic architecture honoured** — pure core / platform port split; only `graph.ts`
   touches Web Audio; no DOM in the mix model. Determinism holds (seeded PRNG;
   identical manifest for unchanged inputs). ✔
2. **Bounded per-frame work** — `AudioMixer.step` reuses one `AudioMix` (asserted by
   object identity); per-frame cost is a fixed set of `AudioParam` writes. ✔
3. **Autoplay + late assets** — sources start only in `unlock()`; `setAssets()` after
   a gesture starts newly-available loops; `unlock` idempotent. ✔
4. **Graceful degradation** — no/throwing `AudioContext` ⇒ null port; missing buffers
   ⇒ silent-but-complete graph; per-bus fetch/decode failure skipped; storage failure
   ⇒ defaults. ✔
5. **Integration resolution** — the rebase conflict in `src/main.ts` was resolved by
   keeping **both** import sets (base's input/a11y/motion + this ticket's audio); no
   side's work was dropped, and the full suite runs green on the merged tree. ✔
6. **Asset serving** — the Vite middleware guards path traversal (`startsWith(ASSET_DIST)`),
   sets correct content types, and `closeBundle` copies the content-addressed dist. ✔

## Non-blocking notes

- `panForSource` is a tested public helper but not called by the port (the HRTF panner
  pans by position). Fine to keep as the documented pan contract; could be dropped later.
- `main.ts` mixes the mix only in the stage-race branch; the `?race=` evidence scene
  has no `onUpdate`, so its bus gains stay at node default if unlocked. Cosmetic.
- The comment above the audio setup still reads "with none supplied … silent" — now
  partly stale since the loader is wired below.
- `rpm`/`load`/`slip` and the listener derive from the keyboard harness (interim,
  documented); weather-preset UI is #APEX-29's.

## Verification (this run, on the rebased tree)

- `bun run typecheck` — clean.
- `bun run test` — **52 files / 372 tests green**.
- `bun run build` — clean; `assets: 6 files, 24301B total (budget=PASS load=PASS)`;
  `dist/assets/audio/{engine,tyres,wind,rain}.*.mp3` emitted.
- No conflict markers left in `src/` or `tests/` (verified by grep + `boot-wiring` test).

## Evidence

- `docs/evidence/APEX-17-tests.txt`, `-typecheck.txt`, `-build.txt`, `-assets-build.txt`.
- `docs/evidence/APEX-34-fix.md`, `-qa.md` — the fix and live probe.
