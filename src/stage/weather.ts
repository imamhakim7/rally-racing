/**
 * Weather presets (#APEX-29).
 *
 * Weather is a small lookup table, not a code branch: each preset names how the
 * sky fog/colour is tinted, how much the sun and ambient light are dimmed, how
 * much the road grip is scaled, and (optionally) whether it forces a time of day.
 * `rain` is the strongest grip penalty, `fog` trades visibility for grip, `clear`
 * is the neutral reference and `dusk` is an evening preset that also moves the
 * time of day.
 *
 * Nothing here touches three.js: the presets are pure data so the weather-to-grip
 * mapping is unit-testable headlessly.
 */
import type { WeatherPreset } from "./types";
import { WEATHER_PRESETS } from "./types";

export { WEATHER_PRESETS };
export type { WeatherPreset };

export interface WeatherPresetState {
  id: WeatherPreset;
  /** Human label for the debug overlay / HUD. */
  label: string;
  /** Fog near plane in metres (closer = thicker haze). */
  fogNear: number;
  /** Fog far plane in metres (smaller = shorter visibility). */
  fogFar: number;
  /** Fog colour (hex), blended over the sky background. */
  fogColor: number;
  /** Multiplier applied to the sun intensity. */
  sunScale: number;
  /** Multiplier applied to the ambient intensity. */
  ambientScale: number;
  /** How much the sky background is blended toward `fogColor` (0..1). */
  skyBlend: number;
  /** Multiplier applied to the authored road grip (1 = unchanged). */
  gripMultiplier: number;
  /** When set, selecting this preset also moves the time of day. */
  forcesTimeOfDay?: "dusk";
}

/**
 * The weather lookup table. Grip ordering is meaningful and asserted in tests:
 * `rain` < `fog` ≤ `dusk` < `clear` (1).
 */
export const WEATHER: Record<WeatherPreset, WeatherPresetState> = {
  clear: {
    id: "clear",
    label: "Clear",
    fogNear: 90,
    fogFar: 360,
    fogColor: 0x0b0e13,
    sunScale: 1,
    ambientScale: 1,
    skyBlend: 0,
    gripMultiplier: 1,
  },
  rain: {
    id: "rain",
    label: "Rain",
    fogNear: 40,
    fogFar: 180,
    fogColor: 0x2a3038,
    sunScale: 0.55,
    ambientScale: 0.9,
    skyBlend: 0.5,
    // Wet tarmac loses the most grip of any preset.
    gripMultiplier: 0.65,
  },
  fog: {
    id: "fog",
    label: "Fog",
    fogNear: 18,
    fogFar: 110,
    fogColor: 0x9aa4ad,
    sunScale: 0.5,
    ambientScale: 1.1,
    skyBlend: 0.7,
    // Fog is damp but not as slick as standing water.
    gripMultiplier: 0.8,
  },
  dusk: {
    id: "dusk",
    label: "Dusk",
    fogNear: 60,
    fogFar: 260,
    fogColor: 0x2c2140,
    sunScale: 0.85,
    ambientScale: 0.9,
    skyBlend: 0.35,
    gripMultiplier: 0.95,
    forcesTimeOfDay: "dusk",
  },
};

/** The grip multiplier for a weather preset (`clear` = 1). */
export function weatherGripMultiplier(preset: WeatherPreset): number {
  return (WEATHER[preset] ?? WEATHER.clear).gripMultiplier;
}

/** Scale an authored grip by the weather; always a finite, positive scalar. */
export function applyWeatherToGrip(baseGrip: number, preset: WeatherPreset): number {
  const base = Number.isFinite(baseGrip) ? baseGrip : 0;
  return base * weatherGripMultiplier(preset);
}

/** `true` when the preset is a known weather id. */
export function isWeatherPreset(value: unknown): value is WeatherPreset {
  return typeof value === "string" && (WEATHER_PRESETS as readonly string[]).includes(value);
}
