/**
 * Shared game settings + persistence (#APEX-12).
 *
 * This is the single settings module for the UI/UX epic: #APEX-12 owns it and
 * #APEX-11 consumes it (see the epic architecture). `normalizeSettings` never
 * throws, so a corrupt persisted value degrades to defaults instead of bricking
 * the boot. The store is behind a `StorageLike` port so tests use a memory store.
 */
import { DEFAULT_BINDINGS, defaultBindings, normalizeBindings, type Bindings } from "./bindings";

export type ReducedMotionPreference = "auto" | "on" | "off";
export type ColorBlindMode = "default" | "deuteranopia" | "protanopia" | "tritanopia";

export const REDUCED_MOTION_PREFERENCES: readonly ReducedMotionPreference[] = ["auto", "on", "off"];
export const COLOR_BLIND_MODES: readonly ColorBlindMode[] = [
  "default",
  "deuteranopia",
  "protanopia",
  "tritanopia",
];

export const MIN_TEXT_SCALE = 1;
export const MAX_TEXT_SCALE = 2;
export const MIN_DEADZONE = 0;
export const MAX_DEADZONE = 0.5;
export const SETTINGS_VERSION = 1;
export const SETTINGS_STORAGE_KEY = "apex.settings.v1";

export interface InputSettings {
  bindings: Bindings;
  /** Gamepad axis deadzone, 0..0.5. */
  deadzone: number;
}

export interface AccessibilitySettings {
  reducedMotion: ReducedMotionPreference;
  colorBlindMode: ColorBlindMode;
  /** Text scale, 1..2 (100 %..200 %). */
  textScale: number;
}

export interface GameSettings {
  version: number;
  input: InputSettings;
  accessibility: AccessibilitySettings;
}

export const DEFAULT_SETTINGS: GameSettings = {
  version: SETTINGS_VERSION,
  input: { bindings: DEFAULT_BINDINGS, deadzone: 0.15 },
  accessibility: { reducedMotion: "auto", colorBlindMode: "default", textScale: 1 },
};

export function defaultSettings(): GameSettings {
  return {
    version: SETTINGS_VERSION,
    input: { bindings: defaultBindings(), deadzone: DEFAULT_SETTINGS.input.deadzone },
    accessibility: { ...DEFAULT_SETTINGS.accessibility },
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Use the value only when it is already in range, else the fallback. */
function rangeOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Coerce arbitrary persisted data into valid settings. Never throws. */
export function normalizeSettings(raw: unknown): GameSettings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const input = typeof source.input === "object" && source.input !== null
    ? (source.input as Record<string, unknown>)
    : {};
  const accessibility = typeof source.accessibility === "object" && source.accessibility !== null
    ? (source.accessibility as Record<string, unknown>)
    : {};

  return {
    version: SETTINGS_VERSION,
    input: {
      bindings: normalizeBindings(input.bindings),
      deadzone: rangeOrDefault(
        input.deadzone,
        MIN_DEADZONE,
        MAX_DEADZONE,
        DEFAULT_SETTINGS.input.deadzone,
      ),
    },
    accessibility: {
      reducedMotion: pickEnum(
        accessibility.reducedMotion,
        REDUCED_MOTION_PREFERENCES,
        DEFAULT_SETTINGS.accessibility.reducedMotion,
      ),
      colorBlindMode: pickEnum(
        accessibility.colorBlindMode,
        COLOR_BLIND_MODES,
        DEFAULT_SETTINGS.accessibility.colorBlindMode,
      ),
      textScale: clampNumber(
        accessibility.textScale,
        MIN_TEXT_SCALE,
        MAX_TEXT_SCALE,
        DEFAULT_SETTINGS.accessibility.textScale,
      ),
    },
  };
}

export interface SettingsStore {
  load(): GameSettings;
  save(settings: GameSettings): void;
  /** Whether persistence is actually available (private mode may be memory-only). */
  readonly persistent: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory store (tests, or when `localStorage` is unavailable). */
export function createMemoryStore(initial: GameSettings = defaultSettings()): SettingsStore {
  let current = normalizeSettings(initial);
  return {
    load: () => normalizeSettings(current),
    save: (settings) => {
      current = normalizeSettings(settings);
    },
    persistent: false,
  };
}

/** Persist to a `StorageLike` (typically `window.localStorage`); falls back to memory. */
export function createLocalStorageStore(
  storage: StorageLike | null | undefined,
  key = SETTINGS_STORAGE_KEY,
): SettingsStore {
  if (!storage) return createMemoryStore();
  const load = (): GameSettings => {
    try {
      const raw = storage.getItem(key);
      return raw ? normalizeSettings(JSON.parse(raw)) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  };
  return {
    load,
    save: (settings) => {
      try {
        storage.setItem(key, JSON.stringify(settings));
      } catch {
        // Quota/private-mode errors must not break the game.
      }
    },
    persistent: true,
  };
}
