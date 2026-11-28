import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_TEXT_SCALE,
  createLocalStorageStore,
  createMemoryStore,
  defaultSettings,
  normalizeSettings,
  type StorageLike,
} from "../src/input/settings";
import { DEFAULT_BINDINGS } from "../src/input/bindings";

describe("normalizeSettings (robustness)", () => {
  it("returns defaults for null/garbage", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings("nope")).toEqual(defaultSettings());
    expect(normalizeSettings({ accessibility: 42 })).toEqual(defaultSettings());
  });

  it("clamps the text scale into range", () => {
    expect(normalizeSettings({ accessibility: { textScale: 5 } }).accessibility.textScale).toBe(MAX_TEXT_SCALE);
    expect(normalizeSettings({ accessibility: { textScale: 0 } }).accessibility.textScale).toBe(1);
    expect(normalizeSettings({ accessibility: { textScale: NaN } }).accessibility.textScale).toBe(1);
  });

  it("rejects unknown enums and deadzones", () => {
    const settings = normalizeSettings({
      input: { deadzone: 9 },
      accessibility: { reducedMotion: "maybe", colorBlindMode: "neon" },
    });
    expect(settings.accessibility.reducedMotion).toBe(DEFAULT_SETTINGS.accessibility.reducedMotion);
    expect(settings.accessibility.colorBlindMode).toBe(DEFAULT_SETTINGS.accessibility.colorBlindMode);
    expect(settings.input.deadzone).toBe(DEFAULT_SETTINGS.input.deadzone);
  });

  it("keeps valid values and normalizes bindings", () => {
    const settings = normalizeSettings({
      input: { deadzone: 0.25, bindings: { throttle: "bad" } },
      accessibility: { reducedMotion: "on", colorBlindMode: "deuteranopia", textScale: 1.5 },
    });
    expect(settings.input.deadzone).toBe(0.25);
    expect(settings.input.bindings.throttle).toEqual(DEFAULT_BINDINGS.throttle);
    expect(settings.accessibility).toMatchObject({
      reducedMotion: "on",
      colorBlindMode: "deuteranopia",
      textScale: 1.5,
    });
  });
});

describe("settings stores", () => {
  it("memory store round-trips and normalizes", () => {
    const store = createMemoryStore();
    expect(store.persistent).toBe(false);
    store.save({ ...defaultSettings(), accessibility: { reducedMotion: "off", colorBlindMode: "default", textScale: 2 } });
    expect(store.load().accessibility).toMatchObject({ reducedMotion: "off", textScale: 2 });
  });

  it("localStorage store persists and survives corrupt JSON", () => {
    const map = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    };
    const store = createLocalStorageStore(storage);
    expect(store.persistent).toBe(true);
    expect(store.load()).toEqual(defaultSettings());

    store.save({ ...defaultSettings(), accessibility: { reducedMotion: "on", colorBlindMode: "tritanopia", textScale: 1.75 } });
    expect(store.load().accessibility).toMatchObject({ reducedMotion: "on", colorBlindMode: "tritanopia" });

    map.set("apex.settings.v1", "{not json");
    expect(store.load()).toEqual(defaultSettings());
  });

  it("falls back to a memory store without storage", () => {
    const store = createLocalStorageStore(null);
    expect(store.persistent).toBe(false);
    expect(store.load()).toEqual(defaultSettings());
  });
});
