/**
 * Audio settings + persistence port (#APEX-17).
 *
 * The mute/volume choice must survive a reload, but the settings *screen* is
 * #APEX-11's. This module owns the shape and a narrow `AudioSettingsStore` port
 * with a `localStorage` default and an in-memory implementation for tests; #APEX-11
 * mounts its UI over the same helpers. Pure enough to test with no DOM.
 */

export interface AudioSettings {
  /** Master mute. */
  muted: boolean;
  /** Master volume, `0..1`. */
  volume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { muted: false, volume: 0.8 };

/** The `localStorage` key audio persists under. */
export const AUDIO_SETTINGS_KEY = "apex.audio.settings";

/** The subset of the Storage API this port uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A persistence port. `read` returns `null` when nothing is stored. */
export interface AudioSettingsStore {
  read(): Partial<AudioSettings> | null;
  write(settings: AudioSettings): void;
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Coerce an untrusted settings candidate into a valid `AudioSettings`,
 * clamping volume and defaulting anything missing or malformed. Never throws.
 */
export function normalizeAudioSettings(input: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    muted: input?.muted === true,
    volume: clamp01(input?.volume ?? DEFAULT_AUDIO_SETTINGS.volume, DEFAULT_AUDIO_SETTINGS.volume),
  };
}

/** An in-memory store for tests and for a session with no persistent storage. */
export function createMemorySettingsStore(initial?: Partial<AudioSettings>): AudioSettingsStore {
  let stored: Partial<AudioSettings> | null = initial ? { ...initial } : null;
  return {
    read: () => (stored ? { ...stored } : null),
    write: (settings) => {
      stored = { muted: settings.muted, volume: settings.volume };
    },
  };
}

/** A `localStorage`-backed store; malformed values read as "nothing stored". */
export function createLocalStorageSettingsStore(
  storage: StorageLike,
  key: string = AUDIO_SETTINGS_KEY,
): AudioSettingsStore {
  return {
    read() {
      try {
        const raw = storage.getItem(key);
        if (raw === null || raw === "") return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        return parsed as Partial<AudioSettings>;
      } catch {
        return null;
      }
    },
    write(settings) {
      try {
        storage.setItem(key, JSON.stringify({ muted: settings.muted, volume: settings.volume }));
      } catch {
        // A disabled/full storage must never break the game.
      }
    },
  };
}

/** Load settings, falling back to defaults when there is no usable store. */
export function loadAudioSettings(store?: AudioSettingsStore | null): AudioSettings {
  if (!store) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    return normalizeAudioSettings(store.read());
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** Persist settings (normalised) and return what was written. */
export function saveAudioSettings(
  store: AudioSettingsStore | null | undefined,
  settings: Partial<AudioSettings>,
): AudioSettings {
  const normalized = normalizeAudioSettings(settings);
  try {
    store?.write(normalized);
  } catch {
    // ignore
  }
  return normalized;
}

/** Set the master mute, persist, and return the new settings. */
export function setAudioMuted(
  store: AudioSettingsStore | null | undefined,
  settings: AudioSettings,
  muted: boolean,
): AudioSettings {
  return saveAudioSettings(store, { ...settings, muted });
}

/** Set the master volume, persist, and return the new settings. */
export function setAudioVolume(
  store: AudioSettingsStore | null | undefined,
  settings: AudioSettings,
  volume: number,
): AudioSettings {
  return saveAudioSettings(store, { ...settings, volume });
}
