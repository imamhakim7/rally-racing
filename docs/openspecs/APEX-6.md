# APEX-6 — glTF/KTX2 Asset Pipeline with Load Budgets

Epic: `2026-Q4-APEX-RALLY-APEX-02` — Stage Circuits & Nature Environments.

Related: **#APEX-4** (data-driven stage format — stages reference runtime assets this
pipeline produces), **#APEX-5** (nature biomes/terrain — consumers of compressed,
budgeted models and textures). This ticket ships the pipeline + budgets only; it does
not render a stage.

## Problem

The brief packs many stage circuits and a nature environment into a browser game. Models,
textures and audio are large; with no defined pipeline the game will exceed the agreed
browser load budget, ship uncompressed meshes and unhashed assets, and leave the CDN
cache surface undefined. Today there is **no** source→dist build, **no** compression,
**no** content hashing, and **no** budget gate that can fail CI.

## Goal

A reproducible asset pipeline turns source assets into **compressed, hashed,
budget-checked runtime bundles**: glTF geometry with Draco **or** meshopt compression and
KTX2/Basis textures, content-hashed file names for long-lived immutable CDN caching, a
manifest, and a CI gate that **fails closed** when a per-asset or total load budget is
exceeded. A cold-start load **simulation** on an agreed throttled profile reports p50/p95
and proves the sample stage fits the budget.

## Non-goals

- **Stage geometry / terrain / biomes** — #APEX-4, #APEX-5. This ticket does not build
  stage worlds; it produces the runtime assets they load.
- **Runtime three.js loading/decoding in the app** — a later ticket wires
  `GLTFLoader`/`KTX2Loader` + the generated manifest into the renderer. We define and
  test the manifest contract here.
- **Real CDN provisioning** — we emit the manifest and cache headers the CDN step
  (`devops`) will consume; we do not configure a bucket.
- **Audio transcoding to Opus** — audio is modelled in the budget/manifest (kind
  `audio`) but the sample uses a small pre-encoded file; no encoder binary is required.

## Architecture

The pipeline is a **pure, headless, deterministic** build: `source → optimize → hash →
manifest → budget/load report`. Every stage is a small function so it is unit-testable
without a browser or network.

```
assets/source/*.{glb,gltf,png,wav}
        │  optimize by kind
        ▼
  ┌──────────────────────────────────────────────┐
  │ model:  gltf-transform  dedup → resample →    │
  │         meshopt|draco → ktx2 textures → prune │
  │ texture: KTX2/Basis (ktx2-encoder)            │
  │ audio:   pass-through (already encoded)       │
  └──────────────────────────────────────────────┘
        │  sha256 content hash (first 8 hex)
        ▼  name.<hash8>.<ext>  →  assets/dist/<kind>/
   manifest.json  { url, hash, bytes, kind, contentType, cacheControl }
        │
        ├── budget.ts      checkAssetBudget(manifest, budgets) → BudgetReport
        └── load-budget.ts simulateColdStart(manifest, profile) → p50/p95 ms
        │
        ▼  fails closed (non-zero exit) on any violation
   docs/evidence/APEX-6-budget-report.{json,txt}
```

### Modules

| Module | Responsibility |
| --- | --- |
| `src/assets/types.ts` | Domain types: `AssetKind`, `AssetRecord`, `AssetManifest`, `BudgetConfig`, `BudgetReport`, `LoadProfile`, `LoadReport`. |
| `src/assets/hash.ts` | `contentHash(bytes)` (sha256, first 8 hex) and `hashedFileName(name, hash)`. |
| `src/assets/optimize.ts` | `optimizeGlb(bytes, opts)` (gltf-transform: dedup, resample, meshopt **or** draco, KTX2 textures, prune); `encodeKtx2(png)`; `detectKind`. |
| `src/assets/manifest.ts` | `buildManifest(entries)`, `writeManifest`/`readManifest`; content types + `Cache-Control: public, max-age=31536000, immutable`. |
| `src/assets/budget.ts` | `checkBudget(manifest, budgets)` → per-asset + per-kind + total checks with named violations; `formatBudgetReport`. |
| `src/assets/load-budget.ts` | `simulateColdStart(manifest, profile, { trials, seed })` → p50/p95 ms; deterministic jitter. |
| `src/assets/pipeline.ts` | `runPipeline({ sourceDir, outDir, budgets, profile })` → `{ manifest, budget, load }`; writes dist + report. |
| `src/assets/cli.ts` | `bun run assets:build` (full build, exits non-zero on budget failure); `assets:check` (budget gate only, for CI). |
| `src/assets/sample.ts` | Deterministically generates the sample-stage source assets (a textured gantry + ground texture) under `assets/source/`. |
| `assets/source/` | Committed sample sources (small): `gate-arch.glb`, `tarmac.png`, `engine.wav`, `tyres.wav`, `wind.wav`, `rain.wav` (#APEX-17). |
| `docs/assets/budgets.json` | The agreed budgets (single source of truth for the gate). |
| `docs/assets/asset-pipeline.md` | The "Asset pipeline" README. |

### Manifest contract

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "1970-01-01T00:00:00.000Z",   // injected clock; deterministic in tests
  "assets": [
    {
      "logicalName": "gate-arch",
      "url": "/assets/models/gate-arch.1a2b3c4d.glb",
      "hash": "1a2b3c4d",
      "bytes": 184320,
      "kind": "model",
      "contentType": "model/gltf-binary",
      "cacheControl": "public, max-age=31536000, immutable"
    }
  ],
  "totals": { "bytes": 262144, "count": 3, "byKind": { "model": 184320, "texture": 61440, "audio": 16384 } }
}
```

- **URLs are content-addressed**: changing a byte changes the hash and therefore the URL,
  which is what makes year-long `immutable` caching safe.
- The importer rewrites logical names → hashed URLs from `manifest.json`; code never
  hard-codes a hash.

### Budgets (agreed at DoR) — `docs/assets/budgets.json`

| Scope | Limit |
| --- | --- |
| `model` per asset | 256 KiB |
| `texture` per asset | 128 KiB |
| `audio` per asset | 64 KiB |
| **total cold-start bytes** | **512 KiB** |
| `coldStartMs.p50` | 1500 ms |
| `coldStartMs.p95` | 2500 ms |

"Agreed budget" = these values, version-controlled and reviewed. Changing a limit is a
one-line diff in `budgets.json` with a note on the ticket.

### Throttled load model (Slow 4G) — `docs/assets/load-profiles.json`

| Field | Value | Meaning |
| --- | --- | --- |
| `name` | `slow-4g` | Chrome DevTools "Slow 4G" |
| `downlinkBytesPerSec` | 200000 | ≈1.6 Mbps downlink |
| `rttMs` | 150 | round-trip latency |
| `connectionSetupMs` | 300 | DNS + TCP + TLS (once, cold) |
| `maxParallelStreams` | 6 | HTTP/2 concurrent streams per connection |
| `jitterPct` | 0.15 | ± per-trial bandwidth jitter (deterministic, seeded) |

Model (documented, deliberately simple and conservative):

```
rounds      = ceil(count / maxParallelStreams)
transferMs  = totalBytes / (downlinkBytesPerSec × (1 + jitter)) × 1000
coldStartMs = connectionSetupMs + rttMs × rounds + transferMs
```

`simulateColdStart` runs N seeded trials, reports `p50`/`p95`. This is an explicit
**model**, not a live network measurement: it lets CI assert a budget deterministically
and reproducibly. The profile numbers are the DevTools preset so the model tracks reality.

### Invariants

1. **Deterministic build.** Same sources + same config ⇒ byte-identical manifest and same
   hashes. No wall clock (time is injected), no unseeded randomness.
2. **Content-addressed outputs.** Output file names are `name.<sha256[:8]>.<ext>`; the
   manifest is the only mapping from logical name to URL.
3. **Fail closed.** Any budget violation makes `assets:build`/`assets:check` exit non-zero
   and names every offending asset and the limit it broke. A clean build is silent.
4. **No secrets, no runtime state committed.** `assets/dist/` is gitignored; only the
   report and sources are committed.
5. **Compression is verified, not assumed.** Tests decode the optimized GLB and assert the
   mesh + KTX2 texture survive and the compression extension is present.
6. **Complete manifest.** Every source asset appears exactly once; every output byte is
   counted in `totals`.

### Edge cases

- Source file with an unknown extension → `kind: "unknown"` and a build error naming it.
- Empty/failed optimization → error; the original bytes are never silently shipped.
- Asset exactly at the limit → passes (limit is inclusive); one byte over → fails.
- Duplicate logical names → build error (ambiguous manifest key).
- A manifest with zero assets → total 0, budget passes, load p95 = setup only.
- `trials < 1` or non-finite profile values → validation error.

## Acceptance criteria (Given/When/Then)

- **AC1 — compressed, hashed model.** Given a source `.glb`, When the pipeline runs, Then
  the output is a valid GLB whose geometry carries `EXT_meshopt_compression` (or
  `KHR_draco_mesh_compression`) and whose textures are `image/ktx2`, and whose file name is
  `name.<sha256[:8]>.glb`.
- **AC2 — content-addressed manifest.** Given the built dist, When `manifest.json` is read,
  Then every entry has a content-addressed `url`, the `hash` matches the file bytes, the
  `bytes` match the file size, and `Cache-Control` is `public, max-age=31536000, immutable`.
- **AC3 — per-asset budget gate fails closed.** Given an asset larger than its kind limit,
  When `checkBudget`, Then `report.ok === false` and a violation names the asset, its kind
  and the exceeded limit; the CLI exits non-zero.
- **AC4 — total budget gate.** Given a manifest whose summed bytes exceed `totalBytes`,
  Then the report fails with a `total` violation even when every asset is individually
  within its kind limit.
- **AC5 — throttled cold-start p95 under budget.** Given the sample-stage manifest and the
  `slow-4g` profile, When `simulateColdStart(..., { trials: 200, seed: … })`, Then
  `p95 <= budgets.coldStartMs.p95` and `p50 <= p95`, and the simulation is deterministic
  for a fixed seed.
- **AC6 — reproducibility.** Given unchanged sources/config, When the pipeline runs twice,
  Then the two manifests are byte-identical (same hashes, same totals).
- **AC7 — budget report artifact.** Given a build, Then
  `docs/evidence/APEX-6-budget-report.{json,txt}` is written with totals, per-kind and
  per-asset rows, the load p50/p95 and an overall `ok` that matches the gate.

## How to test

- **Unit (Vitest, headless):**
  - `tests/hash.test.ts` — hash stability, 8-hex, name formatting (AC1/AC2).
  - `tests/manifest.test.ts` — content type, cache header, totals, read/write (AC2/AC6).
  - `tests/budget.test.ts` — inclusive limit, per-asset & total violations (AC3/AC4).
  - `tests/load-budget.test.ts` — p50≤p95, deterministic seed, budget comparison, edges (AC5).
  - `tests/optimize.test.ts` — optimized GLB round-trips; meshopt/draco extension + KTX2
    texture present; draco and meshopt variants (AC1).
- **Integration (`tests/pipeline.test.ts`):** source → dist → manifest → budget → load;
  assert `ok`, hashed outputs exist, AC6 reproducibility, and that an over-budget fixture
  fails the gate (AC3/AC4/AC6/AC7).
- **Evidence capture:** `bun run assets:build` writes
  `docs/evidence/APEX-6-budget-report.{json,txt}` and `bun run test`/`typecheck` output is
  attached to the ticket.

## Evidence plan

- `docs/evidence/APEX-6-tests.txt`, `APEX-6-typecheck.txt` — green suite + `tsc --noEmit`.
- `docs/evidence/APEX-6-budget-report.json` + `.txt` — the CI budget report for the sample
  stage: per-asset/per-kind/total bytes, budgets, load p50/p95 on `slow-4g`, `ok: true`.
- `docs/evidence/APEX-6-build.txt` — `assets:build` console output.
- Board: openspec published + a note summarising AC coverage and the agreed budget.
