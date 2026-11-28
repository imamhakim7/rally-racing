import { describe, expect, it } from "vitest";
import {
  THREE_ACTIONS,
  clampDifficulty,
  difficultyLabel,
  formatLength,
  homeMenuContent,
  nextStageId,
  settingsView,
  stageCards,
  toStageCard,
} from "../src/ui/menu-model";
import type { StageCatalogEntry } from "../src/stage";
import { defaultSettings } from "../src/input/settings";

const entry = (over: Partial<StageCatalogEntry> = {}): StageCatalogEntry => ({
  id: "alpine-forest",
  name: "Alpine Forest",
  biome: "forest",
  difficulty: 3,
  lengthM: 2400,
  source: "alpine-forest.json",
  ...over,
});

describe("menu view models (#APEX-11)", () => {
  it("formats stage length in m and km", () => {
    expect(formatLength(850)).toBe("850 m");
    expect(formatLength(2400)).toBe("2.4 km");
    expect(formatLength(0)).toBe("—");
    expect(formatLength(Number.NaN)).toBe("—");
  });

  it("labels difficulty as a glyph AND a word (never colour-only)", () => {
    expect(difficultyLabel(3)).toEqual({ glyph: "★★★☆☆", text: "Medium" });
    expect(difficultyLabel(1).glyph).toBe("★☆☆☆☆");
    expect(difficultyLabel(5).glyph).toBe("★★★★★");
    expect(difficultyLabel(5).text).toBe("Expert");
    // Out-of-range values are clamped, never rendered empty.
    expect(difficultyLabel(0).glyph).toBe("★☆☆☆☆");
    expect(difficultyLabel(9).glyph).toBe("★★★★★");
    expect(difficultyLabel(Number.NaN).glyph).toBe("★☆☆☆☆");
  });

  it("projects a stage card with biome, length and difficulty (AC2)", () => {
    const card = toStageCard(entry());
    expect(card).toMatchObject({
      id: "alpine-forest",
      name: "Alpine Forest",
      biome: "forest",
      lengthText: "2.4 km",
      difficulty: 3,
      difficultyText: "Medium",
      difficultyGlyph: "★★★☆☆",
    });
    expect(stageCards([entry(), entry({ id: "b", lengthM: 700 })])).toHaveLength(2);
  });

  it("clamps the raw difficulty on the card too (no 9-star glyph mismatch)", () => {
    expect(clampDifficulty(9)).toBe(5);
    expect(clampDifficulty(0)).toBe(1);
    expect(toStageCard(entry({ difficulty: 9 })).difficulty).toBe(5);
    expect(toStageCard(entry({ difficulty: 9 })).difficultyGlyph).toBe("★★★★★");
  });

  it("wraps to the first stage when advancing past the last (AC4)", () => {
    const ids = ["a", "b", "c"];
    expect(nextStageId(ids, "a")).toBe("b");
    expect(nextStageId(ids, "c")).toBe("a");
    expect(nextStageId(ids, "missing")).toBe("a");
    expect(nextStageId([], "a")).toBe("a");
  });

  it("pins the three-action contract (AC1)", () => {
    expect(THREE_ACTIONS).toEqual(["Play", "Select a stage", "Race"]);
    expect(THREE_ACTIONS).toHaveLength(3);
  });

  it("names the home actions", () => {
    const home = homeMenuContent();
    expect(home.playLabel).toBe("Play");
    expect(home.tutorialLabel).toBe("Tutorial");
    expect(home.settingsLabel).toBe("Settings");
  });

  it("summarises settings as a whole percent, clamped", () => {
    const base = defaultSettings();
    expect(settingsView(base).volumePercent).toBe(80);
    expect(settingsView({ ...base, game: { ...base.game, volume: 2 } }).volumePercent).toBe(100);
    expect(settingsView({ ...base, game: { ...base.game, volume: -1 } }).volumePercent).toBe(0);
  });
});
