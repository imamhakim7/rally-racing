/**
 * Web Audio port (#APEX-17).
 *
 * The platform edge of the audio mix. Everything below it (`mix-model.ts`,
 * `spatial.ts`) is pure; this module is the only place that touches the Web
 * Audio API. It is built over *structural* interfaces so the whole graph can be
 * exercised in Vitest with a fake `AudioContext` and a device with no audio
 * support gets a safe no-op port.
 *
 * Graph shape (epic architecture): a master gain feeding the destination, with a
 * gain per category — engine, tyres, ambience (wind + rain), impacts — and an
 * HRTF panner + gain per opponent car. Sampled loops are pitched by
 * `playbackRate`. Sources start only after `unlock()` (browser autoplay policy).
 */
import type { AudioMix } from "./mix-model";
import { attenuationGain, type ListenerState, type SourceState } from "./spatial";
import type { AudioSettings } from "./settings";

/** The `AudioParam` subset the port writes. */
export interface AudioParamLike {
  value: number;
  setValueAtTime?(value: number, startTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface PannerNodeLike extends AudioNodeLike {
  panningModel?: string;
  distanceModel?: string;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  positionX?: AudioParamLike;
  positionY?: AudioParamLike;
  positionZ?: AudioParamLike;
  setPosition?(x: number, y: number, z: number): unknown;
}

export interface AudioBufferLike {
  duration?: number;
  length?: number;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  playbackRate: AudioParamLike;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface AudioListenerLike {
  positionX?: AudioParamLike;
  positionY?: AudioParamLike;
  positionZ?: AudioParamLike;
  setPosition?(x: number, y: number, z: number): unknown;
  setOrientation?(
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ): unknown;
}

/** The `AudioContext` subset the port uses. */
export interface AudioContextLike {
  readonly state?: string;
  readonly currentTime?: number;
  readonly destination: AudioNodeLike;
  readonly listener?: AudioListenerLike;
  createGain(): GainNodeLike;
  createPanner?(): PannerNodeLike;
  createBufferSource?(): AudioBufferSourceNodeLike;
  /** Decode an encoded audio file (ogg/mp3/wav) into a playable buffer. */
  decodeAudioData?(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume?(): Promise<void> | void;
  close?(): Promise<void> | void;
}

/** A platform object that may expose an `AudioContext` constructor (`window`). */
export interface AudioContextSource {
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
}

/** Sampled loops per bus; missing buffers leave that bus silent. */
export interface AudioBusAssets {
  engine?: AudioBufferLike | null;
  tyres?: AudioBufferLike | null;
  wind?: AudioBufferLike | null;
  rain?: AudioBufferLike | null;
  impact?: AudioBufferLike | null;
  /** The loop opponents' engines/tyres are pitched from. */
  opponent?: AudioBufferLike | null;
}

export interface AudioPortOptions {
  assets?: AudioBusAssets;
  /** Fixed opponent voice pool size. Default 4 (the rally field). */
  maxOpponents?: number;
  /** Gain applied per opponent after attenuation. Default 0.6. */
  opponentVolume?: number;
}

/** A world-space opponent source the port pans + attenuates. */
export interface SpatialSource extends SourceState {
  id?: string;
}

export interface AudioStats {
  available: boolean;
  unlocked: boolean;
  /** Fixed category buses (engine, tyres, wind, rain, impacts). */
  buses: number;
  /** Buffers currently playing (buses + positioned opponents). */
  activeVoices: number;
  /** update() calls applied while unlocked. */
  updates: number;
  /** Cost of the last update() in milliseconds (0 when unavailable). */
  updateCostMs: number;
}

/**
 * A minimal, allocation-conscious audio surface. `available` is false when the
 * platform has no `AudioContext`; every method is then a safe no-op.
 */
export interface AudioPort {
  readonly available: boolean;
  readonly unlocked: boolean;
  /** Resume the context and start the loops. Idempotent; the first gesture calls it. */
  unlock(): void;
  /** Supply/replace sampled loops after construction (assets load asynchronously). */
  setAssets(assets: AudioBusAssets): void;
  /** Decode an encoded audio file (ogg/mp3/wav) on this context; null if unsupported. */
  decode(data: ArrayBuffer): Promise<AudioBufferLike | null>;
  /** Apply master mute/volume. */
  setSettings(settings: AudioSettings): void;
  /** Replace the opponent voice set for this frame. */
  setOpponents(sources: readonly SpatialSource[]): void;
  /** Write one frame of the mix to the graph. */
  update(mix: AudioMix, listener: ListenerState): void;
  /** Frame-budget account for the stats overlay. */
  stats(): AudioStats;
  dispose(): void;
}

const BUS_COUNT = 5; // engine, tyres, wind, rain, impacts
const DEFAULT_MAX_OPPONENTS = 4;
const DEFAULT_OPPONENT_VOLUME = 0.6;

interface OpponentVoice {
  panner: PannerNodeLike;
  gain: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
  /** Last world position from `setOpponents`, used for JS attenuation. */
  x: number;
  y: number;
  z: number;
  positioned: boolean;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;
}

function setParam(param: AudioParamLike | undefined, value: number): void {
  if (!param || !Number.isFinite(value)) return;
  param.value = value;
}

/**
 * The safe no-op port, returned when the platform has no `AudioContext` (or the
 * caller passes `null`). The game is fully playable and silent.
 */
export function createNullAudioPort(): AudioPort {
  const stats: AudioStats = {
    available: false,
    unlocked: false,
    buses: 0,
    activeVoices: 0,
    updates: 0,
    updateCostMs: 0,
  };
  return {
    available: false,
    unlocked: false,
    unlock() {},
    setAssets() {},
    decode: () => Promise.resolve(null),
    setSettings() {},
    setOpponents() {},
    update() {},
    stats: () => ({ ...stats }),
    dispose() {},
  };
}

function startLoop(
  ctx: AudioContextLike,
  buffer: AudioBufferLike | null | undefined,
  destination: AudioNodeLike,
): AudioBufferSourceNodeLike | null {
  if (!buffer || typeof ctx.createBufferSource !== "function") return null;
  let source: AudioBufferSourceNodeLike;
  try {
    source = ctx.createBufferSource();
  } catch {
    return null;
  }
  source.buffer = buffer;
  source.loop = true;
  setParam(source.playbackRate, 1);
  source.connect(destination);
  try {
    source.start(0);
  } catch {
    return null;
  }
  return source;
}

/**
 * Build the Web Audio port over a structural context source. With no usable
 * `AudioContext` constructor the null port is returned, so callers never
 * null-check.
 */
export function createWebAudioPort(
  source?: AudioContextSource | null,
  options: AudioPortOptions = {},
): AudioPort {
  const Ctor = source?.AudioContext ?? source?.webkitAudioContext;
  if (typeof Ctor !== "function") return createNullAudioPort();

  let ctx: AudioContextLike;
  try {
    ctx = new Ctor();
  } catch {
    return createNullAudioPort();
  }

  const assets: AudioBusAssets = { ...(options.assets ?? {}) };
  const maxOpponents = Math.max(
    0,
    Math.floor(Number.isFinite(options.maxOpponents) ? (options.maxOpponents as number) : DEFAULT_MAX_OPPONENTS),
  );
  const opponentVolume = Number.isFinite(options.opponentVolume)
    ? (options.opponentVolume as number)
    : DEFAULT_OPPONENT_VOLUME;

  const master = ctx.createGain();
  master.connect(ctx.destination);

  const engine = ctx.createGain();
  const tyres = ctx.createGain();
  const wind = ctx.createGain();
  const rain = ctx.createGain();
  const impacts = ctx.createGain();
  for (const bus of [engine, tyres, wind, rain, impacts]) bus.connect(master);
  master.gain.value = 0; // silent until settings are applied

  const opponents: OpponentVoice[] = [];
  if (typeof ctx.createPanner === "function") {
    for (let i = 0; i < maxOpponents; i += 1) {
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 10;
      panner.maxDistance = 220;
      // Panner rolloff is 0: JS `attenuationGain` is the single source of truth
      // for distance (tested in `spatial.ts`); HRTF still pans by position.
      panner.rolloffFactor = 0;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      panner.connect(gain);
      gain.connect(master);
      opponents.push({ panner, gain, source: null, x: 0, y: 0, z: 0, positioned: false });
    }
  }

  let unlocked = false;
  let disposed = false;
  let updates = 0;
  let updateCostMs = 0;
  const sources = {
    engine: null as AudioBufferSourceNodeLike | null,
    tyres: null as AudioBufferSourceNodeLike | null,
    wind: null as AudioBufferSourceNodeLike | null,
    rain: null as AudioBufferSourceNodeLike | null,
    impact: null as AudioBufferSourceNodeLike | null,
  };

  function applyListener(listener: ListenerState): void {
    const audioListener = ctx.listener;
    if (!audioListener) return;
    const forwardX = Math.sin(listener.yaw);
    const forwardZ = Math.cos(listener.yaw);
    if (typeof audioListener.setPosition === "function") {
      audioListener.setPosition(listener.x, listener.y, listener.z);
    } else {
      setParam(audioListener.positionX, listener.x);
      setParam(audioListener.positionY, listener.y);
      setParam(audioListener.positionZ, listener.z);
    }
    if (typeof audioListener.setOrientation === "function") {
      audioListener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
    }
  }

  function readVoicePosition(voice: OpponentVoice): SourceState | null {
    if (!voice.positioned) return null;
    return { x: voice.x, y: voice.y, z: voice.z };
  }

  /** Start any bus/opponent loop whose asset is now present but not yet playing. */
  function startBusSources(): void {
    if (!sources.engine) sources.engine = startLoop(ctx, assets.engine, engine);
    if (!sources.tyres) sources.tyres = startLoop(ctx, assets.tyres, tyres);
    if (!sources.wind) sources.wind = startLoop(ctx, assets.wind, wind);
    if (!sources.rain) sources.rain = startLoop(ctx, assets.rain, rain);
    if (!sources.impact) sources.impact = startLoop(ctx, assets.impact, impacts);
    for (const voice of opponents) {
      if (!voice.source) voice.source = startLoop(ctx, assets.opponent, voice.panner);
    }
  }

  return {
    available: true,
    get unlocked() {
      return unlocked;
    },

    unlock() {
      if (disposed || unlocked) return;
      try {
        void ctx.resume?.();
      } catch {
        // A context that refuses to resume stays silent; never throw.
      }
      startBusSources();
      unlocked = true;
    },

    setAssets(next: AudioBusAssets) {
      if (disposed) return;
      Object.assign(assets, next);
      // Assets may arrive after the first gesture; start the newly-available loops.
      if (unlocked) startBusSources();
    },

    decode(data: ArrayBuffer): Promise<AudioBufferLike | null> {
      if (disposed || typeof ctx.decodeAudioData !== "function") {
        return Promise.resolve(null);
      }
      try {
        return Promise.resolve(ctx.decodeAudioData(data)).catch(() => null);
      } catch {
        return Promise.resolve(null);
      }
    },

    setSettings(settings: AudioSettings) {
      setParam(master.gain, settings.muted ? 0 : settings.volume);
    },

    setOpponents(opponentSources: readonly SpatialSource[]) {
      for (let i = 0; i < opponents.length; i += 1) {
        const voice = opponents[i]!;
        const source = opponentSources[i];
        if (!source) {
          voice.positioned = false;
          gainOff(voice);
          continue;
        }
        voice.x = Number.isFinite(source.x) ? source.x : 0;
        voice.y = Number.isFinite(source.y ?? 0) ? (source.y as number) : 0;
        voice.z = Number.isFinite(source.z) ? source.z : 0;
        voice.positioned = true;
        if (typeof voice.panner.setPosition === "function") {
          voice.panner.setPosition(voice.x, voice.y, voice.z);
        } else {
          setParam(voice.panner.positionX, voice.x);
          setParam(voice.panner.positionY, voice.y);
          setParam(voice.panner.positionZ, voice.z);
        }
      }
      if (opponentSources.length === 0) {
        for (const voice of opponents) voice.positioned = false;
      }
    },

    update(mix: AudioMix, listener: ListenerState) {
      if (disposed || !unlocked) return;
      const started = nowMs();
      setParam(engine.gain, mix.engine.gain);
      setParam(tyres.gain, mix.tyres.gain);
      setParam(wind.gain, mix.ambience.wind);
      setParam(rain.gain, mix.ambience.rain);
      setParam(impacts.gain, mix.impacts.gain);
      setParam(sources.engine?.playbackRate, mix.engine.pitch);
      setParam(sources.tyres?.playbackRate, mix.tyres.pitch);

      applyListener(listener);

      const level = (mix.engine.gain + mix.tyres.gain) * 0.5;
      for (const voice of opponents) {
        const position = readVoicePosition(voice);
        if (!position || !voice.source) {
          gainOff(voice);
          continue;
        }
        // Attenuation is JS (single source of truth, unit-tested); the panner
        // handles the HRTF stereo image from the position set in setOpponents.
        const distance = Math.hypot(position.x - listener.x, position.z - listener.z);
        setParam(voice.gain.gain, attenuationGain(distance) * opponentVolume * level);
      }

      updates += 1;
      updateCostMs = Math.max(0, nowMs() - started);
    },

    stats(): AudioStats {
      let active = 0;
      for (const source of [sources.engine, sources.tyres, sources.wind, sources.rain, sources.impact]) {
        if (source) active += 1;
      }
      for (const voice of opponents) if (voice.source && voice.positioned) active += 1;
      return {
        available: true,
        unlocked,
        buses: BUS_COUNT,
        activeVoices: active,
        updates,
        updateCostMs,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const all = [
        sources.engine,
        sources.tyres,
        sources.wind,
        sources.rain,
        sources.impact,
        ...opponents.map((v) => v.source),
      ];
      for (const source of all) {
        try {
          source?.stop();
          source?.disconnect();
        } catch {
          // ignore
        }
      }
      try {
        void ctx.close?.();
      } catch {
        // ignore
      }
      unlocked = false;
    },
  };
}

function gainOff(voice: OpponentVoice): void {
  setParam(voice.gain.gain, 0);
}
