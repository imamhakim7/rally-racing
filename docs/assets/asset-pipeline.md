# Asset pipeline

How Apex Rally turns **source assets** into **compressed, hashed, budget-checked runtime
bundles** — and how CI stops a build that would blow the browser load budget.

Epic: `2026-Q4-APEX-RALLY-APEX-02` · Ticket: **#APEX-6** · Openspec:
[`docs/openspecs/APEX-6.md`](../openspecs/APEX-6.md).

---

## TL;DR

```bash
bun install
bun run assets:sample   # generate the sample-stage sources (deterministic)
bun run assets:build    # source → assets/dist/ + manifest.json + evidence report
bun run assets:check    # CI gate: re-check the built manifest against budgets
bun run assets:dist     # same build, no timestamped evidence (used by prebuild)
bun run test            # unit + integration suite
bun run typecheck       # tsc --noEmit
```

`assets:build` and `assets:check` **exit non-zero** when any per-asset or total load
budget is exceeded. That non-zero exit is the CI gate.

---

## Why

3D models, textures and audio are large. Without a pipeline the game ships uncompressed
meshes and unhashed files, blows the browser load budget, and gives the CDN nothing safe
to cache. The pipeline makes the load budget **a build-time invariant**, not an
after-the-fact hope.

## What it does

```
assets/source/*.{glb,gltf,png,wav}
      │
      │  compress by kind
      ▼
┌─────────────────────────────────────────────────────────────┐
│ model   → gltf-transform: dedup → resample → meshopt|draco   │
│           → KTX2/Basis textures → prune                       │
│ texture → KTX2/Basis (ktx2-encoder, wasm)                    │
│ audio   → PCM WAV → MP3 (lamejs, #APEX-17); already-encoded    │
│           .ogg/.mp3 pass through                              │
└─────────────────────────────────────────────────────────────┘
      │  sha256 content hash (first 8 hex)
      ▼  name.<hash8>.<ext>  →  assets/dist/<kind>/
 manifest.json   { url, hash, bytes, kind, contentType, cacheControl }
      │
      ├─ budget.ts       per-asset + per-kind + total byte gate
      └─ load-budget.ts  throttled cold-start p50/p95 simulation
      ▼
 docs/evidence/APEX-6-budget-report.{json,txt}   (the CI budget report)
```

### Compression

- **Geometry** — glTF with **meshopt** (default) or **Draco** compression
  (`--geometry=draco`). meshopt is the default: a smaller decoder with no extra CDN
  dependency and decompression far faster than Draco.
- **Textures** — **KTX2 / Basis** (`KTX2_SS_NONE`, ETC1S + mipmaps), transcoded to the
  GPU's native compressed format at runtime. KTX2 is ~10⁻¹ the size of PNG and stays
  compressed in VRAM.
- **Audio** — PCM WAV source loops are encoded to **MP3** (`@breezystack/lamejs`,
  #APEX-17) so the load budget carries ~1/5 the bytes; already-encoded `.ogg`/`.mp3`
  sources pass through unchanged.
- Both compression extensions and `KHR_texture_basisu` are written into the GLB; a
  runtime loader must register the matching decoders (a later ticket).

### Content addressing & CDN

Every output is named `name.<sha256[:8]>.<ext>` and served with
`Cache-Control: public, max-age=31536000, immutable`. Changing a single byte changes the
hash and therefore the URL, which is what makes a **year-long immutable** cache safe —
there is no stale-cache invalidation problem. `manifest.json` is the only mapping from a
logical name to its hashed URL; application code never hard-codes a hash.

`manifest.json` entry:

```jsonc
{
  "logicalName": "gate-arch",
  "url": "/assets/models/gate-arch.f7717c9f.glb",
  "hash": "f7717c9f",
  "bytes": 4416,
  "kind": "model",
  "contentType": "model/gltf-binary",
  "cacheControl": "public, max-age=31536000, immutable"
}
```

---

## Budgets (agreed)

Budgets live in [`docs/assets/budgets.json`](budgets.json) — the single source of truth
for the gate. Limits are **inclusive** (an asset exactly at its limit passes).

| Scope | Limit |
| --- | --- |
| model per asset | 256 KiB |
| texture per asset | 128 KiB |
| audio per asset | 64 KiB |
| **total cold-start bytes** | **512 KiB** |
| cold-start p50 | 1500 ms |
| cold-start p95 | 2500 ms (profile `slow-4g`) |

Changing a limit is a one-line diff in `budgets.json` with a note on the ticket.

### Throttled cold-start model

`docs/assets/load-profiles.json` holds the network profiles. The default budget is agreed
against **Slow 4G** (Chrome DevTools preset): 1.6 Mbps down, 150 ms RTT, ~300 ms
connection setup, 6 concurrent HTTP/2 streams, ±15% bandwidth jitter.

```
rounds      = ceil(assetCount / maxParallelStreams)
transferMs  = totalBytes / (downlinkBytesPerSec × (1 + jitter)) × 1000
coldStartMs = connectionSetupMs + rttMs × rounds + transferMs
```

`simulateColdStart` runs 200 **seeded** trials and reports p50/p95. This is an explicit
**model**, not a live network capture: it lets CI assert the budget deterministically and
reproducibly. The numbers are the DevTools preset so the model tracks reality.

---

## Layout

| Path | What |
| --- | --- |
| `assets/source/` | Committed sample-stage sources (`gate-arch.glb`, `tarmac.png`, `engine.wav`, `tyres.wav`, `wind.wav`, `rain.wav`). |
| `assets/dist/` | Built, content-addressed bundles (gitignored; regenerated by `assets:build`). Served at `/assets/*` by the `apex-asset-dist` Vite plugin and copied to `dist/assets/` on build. |
| `docs/assets/budgets.json` | The agreed budgets. |
| `docs/assets/load-profiles.json` | Throttled network profiles. |
| `src/assets/*.ts` | The pipeline modules. |
| `src/assets/cli.ts` | `assets:build` / `assets:check`. |
| `src/assets/sample.ts` | Deterministic sample-source generator. |
| `docs/evidence/APEX-6-budget-report.{json,txt}` | The CI budget report for the sample stage. |

### Modules

| Module | Responsibility |
| --- | --- |
| `types.ts` | Domain types. |
| `hash.ts` | `contentHash` / `hashedFileName` / `splitExt`. |
| `formats.ts` | Extension → kind, content type, CDN directory. |
| `optimize.ts` | `optimizeGlb` (meshopt/draco + KTX2), `encodeKtx2`, `readGlb`. |
| `manifest.ts` | `finalizeAsset` (URL + cache headers), `buildManifest`, read/write. |
| `budget.ts` | `checkBudget` → `BudgetReport` with named violations. |
| `load-budget.ts` | `simulateColdStart` → p50/p95 on a throttled profile. |
| `pipeline.ts` | `runPipeline` — the full source→dist build. |
| `report.ts` | Builds/writes the evidence artifacts. |
| `cli.ts` | The command-line entry point. |

---

## Adding an asset

1. Drop the source file into `assets/source/` (`.glb`/`.gltf` → model, image → texture,
   `.wav`/`.ogg`/`.mp3` → audio).
2. Run `bun run assets:build`.
3. The file is compressed, hashed and added to `manifest.json` with no code change.
   An unknown extension fails the build with a message naming the file.

## Adding an asset of a new type

Add the extension to `KIND_BY_EXT` / `CONTENT_TYPES` in `src/assets/formats.ts`, and if it
needs compression add a branch in `optimizeByKind` (`src/assets/pipeline.ts`).

---

## CI

`.github/workflows/assets-budget.yml` runs on every push:

```
bun install
bun run assets:build     # writes the manifest + report, fails the job on a budget breach
bun run assets:check     # independent re-check of the committed/seeded manifest
bun run typecheck
bun run test
```

A budget or load violation fails the job. The job uploads
`docs/evidence/APEX-6-budget-report.txt` as the budget report artifact.

---

## Evidence for #APEX-6

- `docs/evidence/APEX-6-budget-report.json` / `.txt` — per-asset, per-kind and total
  bytes vs. budget, and the cold-start p50/p95 vs. budget, with an overall `ok`.
- `docs/evidence/APEX-6-build.txt` — `assets:build` output.
- `docs/evidence/APEX-6-tests.txt` — `bun run test`.
- `docs/evidence/APEX-6-typecheck.txt` — `bun run typecheck`.
