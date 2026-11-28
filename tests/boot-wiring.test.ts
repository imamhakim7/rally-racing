import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #APEX-26 — the boot wiring is the one file no unit test imports, so a rebase
// resolution could take "theirs" for src/main.ts and silently revert merged
// features while typecheck, tests and the build stayed green (observed on
// #APEX-7: the capability/support-screen boot path from #9/#APEX-14 and the
// HUD telemetry/minimap from #8 disappeared). The browser gate
// (`scripts/smoke-browsers.mjs`) proves the real bundle boots; this test is the
// fast, always-run half that pins every wiring seam by name.
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("src/main.ts boot wiring", () => {
  it("keeps the WebGL2 capability gate and the unsupported screen (#9/#APEX-14)", () => {
    expect(main).toMatch(/getWebGL2Context\(/);
    expect(main).toMatch(/assessSupport\(/);
    expect(main).toMatch(/resolveQualityPreset\(/);
    expect(main).toMatch(/mountSupportScreen\(/);
  });

  it("keeps the menus, settings and three-action flow (#APEX-11)", () => {
    expect(main).toMatch(/mountMenu\(/);
    expect(main).toMatch(/settingsStore\.load\(\)/);
    expect(main).toMatch(/settingsStore\.save\(/);
    expect(main).toMatch(/mountTutorialOverlay\(/);
    expect(main).toMatch(/onRace:/);
    expect(main).toMatch(/stageSelect: false/);
    expect(main).toMatch(/session\.startWith\(/);
  });

  it("keeps the HUD telemetry/minimap loop and the race boot (#8)", () => {
    expect(main).toMatch(/createTelemetryHarness\(/);
    expect(main).toMatch(/bootRace\(\s*\{/);
    expect(main).toMatch(/setMinimap\(/);
  });

  it("keeps the ?race=<stageId> CPU scene on the same engine clock (#APEX-7)", () => {
    expect(main).toMatch(/get\("race"\)/);
    expect(main).toMatch(/createAiRaceScene\(/);
    expect(main).toMatch(/window\.apexRace\s*=/);
  });

  it("keeps the input abstraction + accessibility wiring (#APEX-12)", () => {
    expect(main).toMatch(/createInputManager\(/);
    expect(main).toMatch(/createLocalStorageStore\(/);
    expect(main).toMatch(/applySettingsToDocument\(/);
    expect(main).toMatch(/mountSettingsPanel\(/);
    expect(main).toMatch(/motionPolicy\(/);
  });

  it("never ships conflict markers", () => {
    expect(main).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });
});
