import { describe, expect, it } from "vitest";
import {
  AUDIO_SETTINGS_KEY,
  createLocalStorageSettingsStore,
  createMemorySettingsStore,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
  setAudioMuted,
  setAudioVolume,
  type StorageLike,
} from "../src/audio/settings";

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("normalizeAudioSettings", () => {
  it("clamps volume and coerces mute", () => {
    expect(normalizeAudioSettings({ muted: true, volume: 5 })).toEqual({ muted: true, volume: 1 });
    expect(normalizeAudioSettings({ muted: false, volume: -2 })).toEqual({ muted: false, volume: 0 });
    expect(normalizeAudioSettings({ muted: "yes" as unknown as boolean, volume: 0.4 })).toEqual({
      muted: false,
      volume: 0.4,
    });
  });

  it("falls back to defaults for missing / non-finite input", () => {
    expect(normalizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(normalizeAudioSettings({ volume: NaN })).toEqual({
      muted: false,
      volume: DEFAULT_AUDIO_SETTINGS.volume,
    });
  });
});

describe("loadAudioSettings / saveAudioSettings — AC5 persistence", () => {
  it("returns defaults with no store", () => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("round-trips through a memory store", () => {
    const store = createMemorySettingsStore();
    saveAudioSettings(store, { muted: true, volume: 0.25 });
    expect(loadAudioSettings(store)).toEqual({ muted: true, volume: 0.25 });
  });

  it("persists mute and volume across a reload through localStorage", () => {
    const storage = fakeStorage();
    const store = createLocalStorageSettingsStore(storage);

    setAudioMuted(store, { muted: false, volume: 0.6 }, true);
    setAudioVolume(store, { muted: true, volume: 0.6 }, 0.15);

    // A fresh store over the same backing storage simulates a page reload.
    const reloaded = loadAudioSettings(createLocalStorageSettingsStore(storage));
    expect(reloaded).toEqual({ muted: true, volume: 0.15 });
    expect(storage.data.has(AUDIO_SETTINGS_KEY)).toBe(true);
  });

  it("falls back to defaults on malformed JSON", () => {
    const storage = fakeStorage();
    storage.data.set(AUDIO_SETTINGS_KEY, "{not json");
    expect(loadAudioSettings(createLocalStorageSettingsStore(storage))).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("never throws when the storage backend does", () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const store = createLocalStorageSettingsStore(throwing);
    expect(loadAudioSettings(store)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveAudioSettings(store, { muted: true, volume: 0.5 })).not.toThrow();
  });
});
