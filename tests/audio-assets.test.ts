import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runPipeline } from "../src/assets/pipeline";
import {
  loadAudioBusAssets,
  resolveAudioUrl,
  selectAudioBusAssets,
  type AudioManifest,
} from "../src/audio/assets";
import type { AssetManifest, BudgetConfig, LoadProfile } from "../src/assets/types";

// #APEX-17 — the shipped build must be audible. This is the regression test the
// QA gate added (#APEX-34): the pipeline must emit encoded bus loops within the
// lead's budget, and the runtime must select, fetch and decode them into the
// Web Audio port's `AudioBusAssets`.

const ROOT = new URL("..", import.meta.url).pathname;
const budgets = JSON.parse(
  readFileSync(join(ROOT, "docs/assets/budgets.json"), "utf8"),
) as BudgetConfig;
const profiles = JSON.parse(
  readFileSync(join(ROOT, "docs/assets/load-profiles.json"), "utf8"),
) as Record<string, LoadProfile>;
const profile = profiles[budgets.profile]!;

let manifest: AssetManifest;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), "apex-audio-"));
  try {
    const result = await runPipeline({
      sourceDir: join(ROOT, "assets/source"),
      outDir,
      budgets,
      profile,
      generatedAt: "2026-01-01T00:00:00.000Z",
      trials: 20,
      seed: 1,
    });
    manifest = result.manifest;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe("#APEX-17 shipped audio — lead hard gate", () => {
  it("ships encoded audio loops (ogg/mp3), not raw wav", () => {
    const audio = manifest.assets.filter((a) => a.kind === "audio");
    expect(audio.length).toBeGreaterThan(0);
    for (const asset of audio) {
      expect(["audio/ogg", "audio/mpeg"]).toContain(asset.contentType);
    }
  });

  it("ships a distinct loop for each mix bus (engine, tyres, wind, rain)", () => {
    const names = manifest.assets
      .filter((a) => a.kind === "audio")
      .map((a) => a.logicalName.toLowerCase());
    for (const bus of ["engine", "tyre", "wind", "rain"]) {
      expect(names.some((n) => n.includes(bus))).toBe(true);
    }
  });

  it("keeps audio assets within the 64 KiB / 512 KiB budget", () => {
    const audio = manifest.assets.filter((a) => a.kind === "audio");
    for (const asset of audio) {
      expect(asset.bytes).toBeLessThanOrEqual(budgets.perAsset.audio);
    }
    expect(manifest.totals.bytes).toBeLessThanOrEqual(budgets.totalBytes);
  });
});

describe("#APEX-17 runtime — the graph must be fed buffers", () => {
  it("boot wiring loads decoded audio into the Web Audio port", () => {
    const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");
    expect(main).toMatch(/loadAudioBusAssets|decodeAudioData|audioAssets/);
    expect(main).toMatch(/setAssets\(/);
  });

  it("selects bus loops by logical name and ignores non-audio / unknown", () => {
    const selected = selectAudioBusAssets({
      assets: [
        { logicalName: "Engine", url: "/a.mp3", kind: "audio" },
        { logicalName: "tyre", url: "/b.mp3", kind: "audio" }, // alias -> tyres
        { logicalName: "tarmac", url: "/c.ktx2", kind: "texture" },
        { logicalName: "ambient", url: "/d.mp3", kind: "audio" }, // no bus
      ],
    });
    expect(selected).toEqual([
      { bus: "engine", logicalName: "Engine", url: "/a.mp3" },
      { bus: "tyres", logicalName: "tyre", url: "/b.mp3" },
    ]);
  });

  it("resolves manifest URLs under a sub-path (GitHub Pages base)", () => {
    const base = "https://host/rally-racing/";
    expect(resolveAudioUrl("/assets/audio/x.mp3", base)).toBe(
      "https://host/rally-racing/assets/audio/x.mp3",
    );
    expect(resolveAudioUrl("https://cdn.example/x.mp3", base)).toBe("https://cdn.example/x.mp3");
  });

  it("fetches and decodes each bus loop, skipping failures", async () => {
    const manifest: AudioManifest = {
      assets: [
        { logicalName: "engine", url: "/assets/audio/engine.aaaaaaaa.mp3", kind: "audio" },
        { logicalName: "tyres", url: "/assets/audio/tyres.bbbbbbbb.mp3", kind: "audio" },
        { logicalName: "wind", url: "/assets/audio/wind.cccccccc.mp3", kind: "audio" },
        { logicalName: "rain", url: "/assets/audio/rain.dddddddd.mp3", kind: "audio" },
      ],
    };
    const fetched: string[] = [];
    const assets = await loadAudioBusAssets(
      manifest,
      async (data) => {
        if (data.byteLength === 0) throw new Error("decode failed");
        return { duration: 1 };
      },
      {
        base: "https://host/rally-racing/",
        fetcher: async (url) => {
          fetched.push(url);
          // Simulate the rain loop failing to decode.
          return url.includes("rain") ? new ArrayBuffer(0) : new ArrayBuffer(8);
        },
      },
    );
    expect(fetched).toHaveLength(4);
    expect(Object.keys(assets).sort()).toEqual(["engine", "tyres", "wind"]);
    expect(assets.rain).toBeUndefined();
  });
});
