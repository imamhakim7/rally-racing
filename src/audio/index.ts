/**
 * Dynamic car and environment audio mix (#APEX-17).
 *
 * Pure mix decisions (`mix-model`, `spatial`) behind a Web Audio port
 * (`graph`), with a persistence port for mute/volume (`settings`). Consumers
 * import from this barrel; the composition root (`src/main.ts`) builds the port
 * from `window` and writes one frame per tick.
 */
export {
  AMBIENCE_AUDIO,
  AudioMixer,
  computeAudioMix,
  ENGINE_AUDIO,
  IMPACT_AUDIO,
  silentMix,
  SURFACE_AUDIO,
  type AudioBusId,
  type AudioMix,
  type AudioMixerOptions,
  type BusMix,
  type CarAudioState,
  type EnvironmentAudioState,
  type SurfaceAudio,
} from "./mix-model";
export {
  ATTENUATION,
  attenuationGain,
  chaseYaw,
  listenerFromCar,
  panForSource,
  planarDistance,
  type AttenuationOptions,
  type ListenerState,
  type SourceState,
} from "./spatial";
export {
  AUDIO_SETTINGS_KEY,
  createLocalStorageSettingsStore,
  createMemorySettingsStore,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
  setAudioMuted,
  setAudioVolume,
  type AudioSettings,
  type AudioSettingsStore,
  type StorageLike,
} from "./settings";
export {
  createNullAudioPort,
  createWebAudioPort,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioBusAssets,
  type AudioContextLike,
  type AudioContextSource,
  type AudioListenerLike,
  type AudioNodeLike,
  type AudioParamLike,
  type AudioPort,
  type AudioPortOptions,
  type AudioStats,
  type GainNodeLike,
  type PannerNodeLike,
  type SpatialSource,
} from "./graph";
export {
  loadAudioBusAssets,
  resolveAudioUrl,
  selectAudioBusAssets,
  type AudioBusName,
  type AudioManifest,
  type AudioManifestAsset,
  type LoadAudioOptions,
  type SelectedAudioAsset,
} from "./assets";
