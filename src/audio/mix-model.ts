/**
 * Dynamic audio mix model (#APEX-17).
 *
 * The *decisions* of the mix live here: pure, deterministic, headless
 * TypeScript with no DOM and no Web Audio (epic architecture principle 2).
 * `computeAudioMix` maps car state (`rpm`, `load`, `slip`, `surface`, `impact`)
 * and environment state (`wind`, `rain`) onto per-bus gains and pitch rates;
 * `graph.ts` turns that snapshot into Web Audio param writes.
 *
 * The numbers are deliberately spread far apart so the difference is measurable
 * in a headless test, not just audible:
 *
 *   tarmac  quiet, high-pitched tyre    — the reference surface
 *   gravel  loud, low-pitched, rough    — the "you are on gravel" tell
 *   mud     quieter, lowest pitch       — muffled, heavy
 *   ice     quiet, high-pitched         — thin, glassy
 */
import type { SurfaceId } from "../physics/surface";

export type AudioBusId = "engine" | "tyres" | "ambience" | "impacts";

/** The car-derived inputs to the mix. All `01` fields are normalised `[0,1]`. */
export interface CarAudioState {
  /** Engine speed normalised against the rev limit. */
  rpm01: number;
  /** Throttle / engine load, `0` coasting .. `1` wide open. */
  load01: number;
  /** Ground speed normalised against top speed. */
  speed01: number;
  /** Tyre slip (longitudinal + lateral) normalised `0..1`. */
  slip01: number;
  /** The surface the car is on. */
  surface: SurfaceId;
  /** A decaying impact impulse `0..1` for the frame (0 when none). */
  impact01: number;
}

/** Environment inputs, supplied by the weather preset (#APEX-29) or a dry default. */
export interface EnvironmentAudioState {
  /** Wind layer strength `0..1`. */
  wind01: number;
  /** Rain layer strength `0..1`. */
  rain01: number;
}

export interface BusMix {
  gain: number;
  /** Playback rate multiplier for the sampled loop (1 = recorded pitch). */
  pitch: number;
}

/** A resolved frame of the mix, ready to write to the Web Audio graph. */
export interface AudioMix {
  engine: BusMix;
  tyres: BusMix;
  ambience: { wind: number; rain: number };
  impacts: BusMix;
  surface: SurfaceId;
}

/** Per-surface tyre timbre. Rows are distinct so a surface change is audible. */
export interface SurfaceAudio {
  /** Base tyre-scrub gain on this surface. */
  tyresGain: number;
  /** Base playback rate (pitch) of the tyre loop. */
  tyresPitch: number;
  /** Roughness character `0..1` (gravel/mud rough, tarmac/ice smooth). */
  timbre: number;
}

export const SURFACE_AUDIO: Record<SurfaceId, SurfaceAudio> = {
  tarmac: { tyresGain: 0.3, tyresPitch: 1.0, timbre: 0.18 },
  gravel: { tyresGain: 0.72, tyresPitch: 0.8, timbre: 0.78 },
  mud: { tyresGain: 0.55, tyresPitch: 0.68, timbre: 0.92 },
  ice: { tyresGain: 0.42, tyresPitch: 1.18, timbre: 0.3 },
};

export const ENGINE_AUDIO = {
  /** Playback rate at idle. */
  idleRate: 0.5,
  /** Extra rate at the rev limit. */
  rpmSpan: 2.6,
  /** Gain at full load. */
  baseGain: 0.9,
  /** Fraction of `baseGain` present at zero load (engine braking / idle). */
  baseLoad: 0.32,
  /** Fraction of gain that always scales with rpm, so revs are audible too. */
  rpmWeight: 0.4,
} as const;

export const AMBIENCE_AUDIO = {
  /** Fraction of the wind layer present at a standstill. */
  windRoll: 0.35,
} as const;

export const IMPACT_AUDIO = {
  /** Gain at a full-strength impact. */
  gain: 0.8,
} as const;

const CAR_DEFAULT: CarAudioState = {
  rpm01: 0,
  load01: 0,
  speed01: 0,
  slip01: 0,
  surface: "tarmac",
  impact01: 0,
};

const ENV_DEFAULT: EnvironmentAudioState = { wind01: 0, rain01: 0 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function withDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function surfaceProfile(surface: SurfaceId): SurfaceAudio {
  return SURFACE_AUDIO[surface] ?? SURFACE_AUDIO.tarmac;
}

/**
 * Resolve one frame of the mix. Pure: identical inputs give a deeply equal
 * mix, and no input (however malformed) throws — non-finite values clamp to
 * neutral defaults.
 */
export function computeAudioMix(
  car: Partial<CarAudioState> | null | undefined,
  env: Partial<EnvironmentAudioState> | null | undefined,
): AudioMix {
  const rpm = clamp01(withDefault(car?.rpm01 ?? CAR_DEFAULT.rpm01, CAR_DEFAULT.rpm01));
  const load = clamp01(withDefault(car?.load01 ?? CAR_DEFAULT.load01, CAR_DEFAULT.load01));
  const speed = clamp01(withDefault(car?.speed01 ?? CAR_DEFAULT.speed01, CAR_DEFAULT.speed01));
  const slip = clamp01(withDefault(car?.slip01 ?? CAR_DEFAULT.slip01, CAR_DEFAULT.slip01));
  const impact = clamp01(withDefault(car?.impact01 ?? CAR_DEFAULT.impact01, CAR_DEFAULT.impact01));
  const surface = car?.surface ?? CAR_DEFAULT.surface;
  const profile = surfaceProfile(surface);

  const wind = clamp01(withDefault(env?.wind01 ?? ENV_DEFAULT.wind01, ENV_DEFAULT.wind01));
  const rain = clamp01(withDefault(env?.rain01 ?? ENV_DEFAULT.rain01, ENV_DEFAULT.rain01));

  // Engine: pitch tracks rpm, gain tracks load (with a constant rpm component so
  // revs are audible at partial throttle too).
  const engineGain =
    ENGINE_AUDIO.baseGain *
    (ENGINE_AUDIO.baseLoad + (1 - ENGINE_AUDIO.baseLoad) * load) *
    (1 - ENGINE_AUDIO.rpmWeight + ENGINE_AUDIO.rpmWeight * rpm);
  const enginePitch = ENGINE_AUDIO.idleRate + rpm * ENGINE_AUDIO.rpmSpan;

  // Tyres: surface timbre dominates, slip/speed scale the energy.
  const tyreEnergy = clamp01(slip * 0.85 + speed * 0.15);
  const tyreGain = clamp01(profile.tyresGain * tyreEnergy);
  const tyrePitch = profile.tyresPitch * (0.92 + 0.16 * slip);

  // Ambience: independent wind and rain layers; wind grows with speed.
  const windLayer = clamp01(wind * (AMBIENCE_AUDIO.windRoll + (1 - AMBIENCE_AUDIO.windRoll) * speed));
  const rainLayer = clamp01(rain);

  return {
    engine: { gain: clamp01(engineGain), pitch: enginePitch },
    tyres: { gain: tyreGain, pitch: tyrePitch },
    ambience: { wind: windLayer, rain: rainLayer },
    impacts: { gain: clamp01(impact * IMPACT_AUDIO.gain), pitch: 1 },
    surface: profile === SURFACE_AUDIO[surface] ? surface : "tarmac",
  };
}

/** A neutral all-silent mix (stopped engine, no weather). */
export function silentMix(): AudioMix {
  return computeAudioMix(CAR_DEFAULT, ENV_DEFAULT);
}

export interface AudioMixerOptions {
  /** Approach rate toward the target mix, per second. Default 12. */
  smoothing?: number;
}

/**
 * Stateful wrapper that eases the live mix toward the target so gains do not
 * zipper. `step` mutates and reuses one `AudioMix` object (bounded allocation in
 * the hot path); `target` resolves the raw target without smoothing.
 */
export class AudioMixer {
  private readonly smoothing: number;
  private readonly live: AudioMix;
  private initialised = false;

  constructor(options: AudioMixerOptions = {}) {
    this.smoothing = Number.isFinite(options.smoothing) && options.smoothing! >= 0
      ? options.smoothing!
      : 12;
    this.live = silentMix();
  }

  /** Resolve the unsmoothed target mix for a frame. */
  target(car: CarAudioState, env: EnvironmentAudioState): AudioMix {
    return computeAudioMix(car, env);
  }

  /** Current eased mix (same object identity each frame). */
  get current(): AudioMix {
    return this.live;
  }

  /**
   * Ease the live mix toward the target by `dt` seconds and return it. The first
   * step snaps to the target (avoids an unmusical fade-in from silence).
   */
  step(car: CarAudioState, env: EnvironmentAudioState, dt: number): AudioMix {
    const next = computeAudioMix(car, env);
    const alpha = this.initialised ? 1 - Math.exp(-this.smoothing * Math.max(0, dt)) : 1;
    this.live.engine.gain += (next.engine.gain - this.live.engine.gain) * alpha;
    this.live.engine.pitch += (next.engine.pitch - this.live.engine.pitch) * alpha;
    this.live.tyres.gain += (next.tyres.gain - this.live.tyres.gain) * alpha;
    this.live.tyres.pitch += (next.tyres.pitch - this.live.tyres.pitch) * alpha;
    this.live.ambience.wind += (next.ambience.wind - this.live.ambience.wind) * alpha;
    this.live.ambience.rain += (next.ambience.rain - this.live.ambience.rain) * alpha;
    this.live.impacts.gain += (next.impacts.gain - this.live.impacts.gain) * alpha;
    this.live.impacts.pitch = next.impacts.pitch;
    this.live.surface = next.surface;
    this.initialised = true;
    return this.live;
  }

  /** Snap the live mix to the target (used on stage change / reset). */
  reset(car: CarAudioState = CAR_DEFAULT, env: EnvironmentAudioState = ENV_DEFAULT): AudioMix {
    this.initialised = false;
    return this.step(car, env, 0);
  }
}
