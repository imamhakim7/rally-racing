/**
 * Dynamic sky and time-of-day (#APEX-29).
 *
 * A small keyframe curve over a **day fraction** `[0,1)` defines the sky
 * background, sun colour/intensity/direction and ambient light. Named times
 * (`midday`, `dusk`) map onto fractions, and a ray of keyframes is interpolated,
 * so the time of day is genuinely configurable while `#APEX-28`'s
 * `terrainLighting` keeps its two named values.
 *
 * `createSkyRig` owns the scene's hemisphere + directional lights and its
 * `background`/`fog`, and exposes `setTimeOfDay`/`setWeather` so the environment
 * can be toggled at runtime. Weather is layered on by `skyState`, which is why
 * `terrainLighting` delegates here — the terrain seam and the sky can never
 * disagree.
 */
import * as THREE from "three";
import type { WeatherPreset } from "./types";
import { WEATHER, isWeatherPreset, weatherGripMultiplier } from "./weather";
import type { WeatherPresetState } from "./weather";

/** The two named times shipped stages use; a numeric day fraction is also accepted. */
export type TimeOfDay = "midday" | "dusk";

/** A named time of day or a raw day fraction in `[0,1)`. */
export type TimeOfDaySpec = TimeOfDay | number;

/** Named times resolve to these day fractions. */
export const TIME_FRACTIONS: Record<TimeOfDay, number> = {
  midday: 0.5,
  dusk: 0.85,
};

export type ColorTuple = readonly [number, number, number];

interface SkyKeyframe {
  at: number;
  background: number;
  sunColor: number;
  sunIntensity: number;
  sunDirection: ColorTuple;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
}

/**
 * The day curve. Night at both ends, dawn, midday and dusk between; interpolation
 * makes the whole `[0,1)` range renderable, so the time of day is configurable.
 */
export const SKY_KEYFRAMES: readonly SkyKeyframe[] = [
  {
    at: 0,
    background: 0x05070d,
    sunColor: 0x2b3a5c,
    sunIntensity: 0.15,
    sunDirection: [-40, 20, 30],
    ambientSky: 0x1b2740,
    ambientGround: 0x0a0c10,
    ambientIntensity: 0.25,
  },
  {
    at: 0.15,
    background: 0x2c3b5a,
    sunColor: 0xffb27a,
    sunIntensity: 0.9,
    sunDirection: [-80, 18, 40],
    ambientSky: 0x8fa4d0,
    ambientGround: 0x3a3126,
    ambientIntensity: 0.6,
  },
  {
    at: 0.5,
    background: 0x8fc4ff,
    sunColor: 0xfff0d0,
    sunIntensity: 2.0,
    sunDirection: [60, 90, 40],
    ambientSky: 0x9dc4ff,
    ambientGround: 0x3a3126,
    ambientIntensity: 0.85,
  },
  {
    at: 0.85,
    background: 0x6b4a6e,
    sunColor: 0xff9d5c,
    sunIntensity: 1.35,
    sunDirection: [-70, 26, 55],
    ambientSky: 0xb07a86,
    ambientGround: 0x2e2436,
    ambientIntensity: 0.5,
  },
  {
    at: 1,
    background: 0x05070d,
    sunColor: 0x2b3a5c,
    sunIntensity: 0.15,
    sunDirection: [-40, 20, 30],
    ambientSky: 0x1b2740,
    ambientGround: 0x0a0c10,
    ambientIntensity: 0.25,
  },
];

/** The concrete lighting + fog a `SkyRig` writes into a scene. */
export interface SkyState {
  timeOfDay: TimeOfDay;
  dayFraction: number;
  background: number;
  sunColor: number;
  sunIntensity: number;
  sunDirection: ColorTuple;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  weather: WeatherPreset;
  /** Weather grip multiplier in force (1 = dry). */
  gripMultiplier: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Resolve a named time or day fraction to a fraction in `[0,1]`. */
export function timeOfDayFraction(spec: TimeOfDaySpec): number {
  if (typeof spec === "number") return clamp01(spec);
  return TIME_FRACTIONS[spec] ?? TIME_FRACTIONS.midday;
}

/** The named time a fraction is closest to (used for the rig's public getter). */
export function nearestTimeOfDay(fraction: number): TimeOfDay {
  return Math.abs(fraction - TIME_FRACTIONS.dusk) < Math.abs(fraction - TIME_FRACTIONS.midday)
    ? "dusk"
    : "midday";
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const scratchA = new THREE.Color();
const scratchB = new THREE.Color();
const scratchOut = new THREE.Color();

/** Linear colour interpolation between two hex colours (sRGB). */
function lerpColor(a: number, b: number, t: number): number {
  scratchA.setHex(a);
  scratchB.setHex(b);
  scratchOut.copy(scratchA).lerp(scratchB, t);
  return scratchOut.getHex();
}

function lerpTuple(a: ColorTuple, b: ColorTuple, t: number): ColorTuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function sampleKeyframes(fraction: number): Omit<SkyKeyframe, "at"> {
  const frames = SKY_KEYFRAMES;
  let lo = frames[0]!;
  let hi = frames[frames.length - 1]!;
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (fraction >= a.at && fraction <= b.at) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi.at - lo.at;
  const t = span > 1e-9 ? (fraction - lo.at) / span : 0;
  return {
    background: lerpColor(lo.background, hi.background, t),
    sunColor: lerpColor(lo.sunColor, hi.sunColor, t),
    sunIntensity: lerp(lo.sunIntensity, hi.sunIntensity, t),
    sunDirection: lerpTuple(lo.sunDirection, hi.sunDirection, t),
    ambientSky: lerpColor(lo.ambientSky, hi.ambientSky, t),
    ambientGround: lerpColor(lo.ambientGround, hi.ambientGround, t),
    ambientIntensity: lerp(lo.ambientIntensity, hi.ambientIntensity, t),
  };
}

/**
 * The concrete sky for a time of day and weather preset. Pure: same inputs always
 * yield the same state, which is what makes the mapping unit-testable.
 */
export function skyState(timeOfDay: TimeOfDaySpec, weather: WeatherPreset = "clear"): SkyState {
  const preset: WeatherPresetState = WEATHER[weather] ?? WEATHER.clear;
  const fraction = timeOfDayFraction(timeOfDay);
  const base = sampleKeyframes(fraction);
  const named = typeof timeOfDay === "string" ? timeOfDay : nearestTimeOfDay(fraction);
  return {
    timeOfDay: named,
    dayFraction: fraction,
    background: lerpColor(base.background, preset.fogColor, preset.skyBlend),
    sunColor: base.sunColor,
    sunIntensity: base.sunIntensity * preset.sunScale,
    sunDirection: base.sunDirection,
    ambientSky: lerpColor(base.ambientSky, preset.fogColor, preset.skyBlend * 0.5),
    ambientGround: base.ambientGround,
    ambientIntensity: base.ambientIntensity * preset.ambientScale,
    fogColor: preset.fogColor,
    fogNear: preset.fogNear,
    fogFar: preset.fogFar,
    weather: preset.id,
    gripMultiplier: weatherGripMultiplier(preset.id),
  };
}

/** Runtime-controllable sky + weather rig bound to one scene. */
export interface SkyRig {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly timeOfDay: TimeOfDay;
  readonly weather: WeatherPreset;
  readonly state: SkyState;
  /** Set the time of day by name or day fraction; re-applies the scene. */
  setTimeOfDay(spec: TimeOfDaySpec): SkyState;
  /** Switch weather preset at runtime; re-applies the scene. */
  setWeather(preset: WeatherPreset): SkyState;
  dispose(): void;
}

export interface SkyRigOptions {
  timeOfDay?: TimeOfDaySpec;
  weather?: WeatherPreset;
  /** Directional-light shadow map size (default 1024). */
  shadowMapSize?: number;
  /** Enable the sun's shadow (default true). */
  shadows?: boolean;
}

/**
 * Create a sky rig over `scene`. The rig owns the hemisphere + directional lights
 * and the scene's `background`/`fog`; `dispose` removes the lights it added.
 */
export function createSkyRig(scene: THREE.Scene, options: SkyRigOptions = {}): SkyRig {
  const ambient = new THREE.HemisphereLight(0x9dc4ff, 0x3a3126, 0.85);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.castShadow = options.shadows ?? true;
  const shadowMapSize = options.shadowMapSize ?? 1024;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);

  scene.add(ambient);
  scene.add(sun);
  scene.add(sun.target);

  if (!(scene.background instanceof THREE.Color)) {
    scene.background = new THREE.Color(0x0b0e13);
  }
  if (!scene.fog) {
    scene.fog = new THREE.Fog(0x0b0e13, 90, 360);
  }

  let fraction = timeOfDayFraction(options.timeOfDay ?? "midday");
  let weather: WeatherPreset = options.weather && isWeatherPreset(options.weather) ? options.weather : "clear";
  let state = skyState(fraction, weather);

  const fog = scene.fog as THREE.Fog;
  const background = scene.background as THREE.Color;

  function apply(): void {
    state = skyState(fraction, weather);
    background.setHex(state.background);
    fog.color.setHex(state.fogColor);
    fog.near = state.fogNear;
    fog.far = state.fogFar;
    sun.color.setHex(state.sunColor);
    sun.intensity = state.sunIntensity;
    sun.position.set(state.sunDirection[0], state.sunDirection[1], state.sunDirection[2]);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    ambient.color.setHex(state.ambientSky);
    ambient.groundColor.setHex(state.ambientGround);
    ambient.intensity = state.ambientIntensity;
    scene.background = background;
    scene.fog = fog;
  }

  function setWeather(preset: WeatherPreset): SkyState {
    if (!isWeatherPreset(preset)) return state;
    weather = preset;
    const forced = WEATHER[preset].forcesTimeOfDay;
    if (forced) fraction = timeOfDayFraction(forced);
    apply();
    return state;
  }

  apply();

  return {
    scene,
    sun,
    ambient,
    get timeOfDay() {
      return state.timeOfDay;
    },
    get weather() {
      return weather;
    },
    get state() {
      return state;
    },
    setTimeOfDay(spec) {
      fraction = timeOfDayFraction(spec);
      apply();
      return state;
    },
    setWeather,
    dispose() {
      scene.remove(ambient);
      scene.remove(sun);
      scene.remove(sun.target);
    },
  };
}
