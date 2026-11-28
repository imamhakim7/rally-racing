import { createEngine, type EngineApp, type SceneHandle } from "./engine";
import { getWebGL2Context } from "./engine/renderer";
import {
  assessSupport,
  detectCapabilities,
  forcedUnsupportedAssessment,
  resolveQualityPreset,
  type DeviceHints,
  type GlCapabilities,
  type SupportAssessment,
} from "./engine/capabilities";
import {
  StageLibrary,
  createStageScene,
  sampleSpline,
  toStageDefinition,
  type StageSceneHandle,
} from "./stage";
import {
  PaceNoteTracker,
  bootRace,
  buildPaceNotes,
  createSpeechVoice,
  createTelemetryHarness,
  nearestDistanceOnSpline,
  type SpeechSource,
  type Voice,
} from "./race";
import { createKeyboardInput, type InputSource, type KeyboardTarget } from "./input/keyboard";
import { mountSupportScreen } from "./ui/supportScreen";
import { mountMenu, type MenuHandle } from "./ui/menu";
import { nextStageId } from "./ui/menu-model";
import { TutorialModel } from "./ui/tutorial";
import { mountTutorialOverlay, type TutorialOverlayHandle } from "./ui/tutorialOverlay";
import { createAiRaceScene, type AiRaceScene } from "./scenes/aiRaceScene";
import { physicsSurfaceAt } from "./ai";
import {
  AudioMixer,
  createLocalStorageSettingsStore,
  createMemorySettingsStore,
  createWebAudioPort,
  listenerFromCar,
  loadAudioBusAssets,
  loadAudioSettings,
  resolveAudioUrl,
  setAudioMuted,
  setAudioVolume,
  type AudioContextSource,
  type AudioManifest,
  type AudioPort,
  type AudioSettings,
  type AudioSettingsStore,
  type CarAudioState,
  type EnvironmentAudioState,
} from "./audio";
import {
  createInputManager,
  createLocalStorageStore,
  type GameSettings,
  type InputManager,
} from "./input";
import { applySettingsToDocument, systemPrefersReducedMotion } from "./ui/a11y";
import { motionPolicy, resolveMotionState } from "./engine/motion";
import { mountMotionBlur } from "./ui/motionBlur";
import { createTouchControls } from "./ui/touchControls";
import { mountSettingsPanel, type SettingsPanelHandle } from "./ui/settingsPanel";

/**
 * Browser entry point. Boots the engine with the stage scene and wires the
 * (minimal) stage select, then layers the stage race loop on top. With
 * `?race=<stageId>` it boots the visible CPU race scene (#APEX-7) instead.
 *
 * Boot order matters here: WebGL2 and the required extensions are detected
 * *first*. A browser that cannot run the game gets an actionable unsupported
 * screen instead of a thrown error and a black canvas (#APEX-14); a supported
 * browser gets a capability-derived quality preset.
 *
 * All simulation lives in `src/engine` / `src/ai`; stage data and world building
 * live in `src/stage`; race state lives in `src/race`. The engine's fixed-timestep
 * loop drives everything through one clock: the scene (via `sceneHandle.update`)
 * and, when present, the race loop (via `onUpdate`), so world physics and race
 * timing stay frame-rate independent and in lockstep.
 *
 * Integration note: the vehicle (#APEX-2, `src/physics`) consumes the resolved
 * `StageWorld` (surface zones, gate transforms, spline); in-world gate detection
 * for the race loop is left to a later integration ticket, so the race HUD hosts
 * a keyboard harness for crossings (see `docs/openspecs/APEX-3.md` non-goals).
 * The `?race=` scene is the watchable CPU race from #APEX-7 (evidence/playtest),
 * built on the same `CpuDriver` + `Vehicle` logic as the headless simulator.
 */
const canvasElement = document.getElementById("app");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}
const canvas: HTMLCanvasElement = canvasElement;

function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency };
}

/**
 * #APEX-17: persistence for the audio mute/volume. Uses `localStorage` where it
 * is available (and not blocked), otherwise an in-memory store so the game still
 * runs. `localStorage` access itself can throw in a sandboxed frame.
 */
function audioSettingsStore(): AudioSettingsStore {
  try {
    return createLocalStorageSettingsStore(window.localStorage);
  } catch {
    return createMemorySettingsStore();
  }
}

/**
 * Probe WebGL2 on a throwaway canvas so the app canvas context is created once,
 * later, with the preset's `antialias` attribute. Context attributes are fixed at
 * creation and a supplied context makes three.js ignore its own `antialias`
 * option — probing on the app canvas would silently force antialias on.
 */
function detectBootCapabilities(): GlCapabilities {
  try {
    const probe = document.createElement("canvas");
    const context = getWebGL2Context(probe);
    const caps = detectCapabilities(context);
    const lose = context?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null;
    lose?.loseContext();
    return caps;
  } catch {
    return detectCapabilities(null);
  }
}

/** Detect support without ever throwing (context creation can throw in the wild). */
function resolveAssessment(): SupportAssessment {
  if (new URLSearchParams(location.search).get("forceUnsupported") === "1") {
    return forcedUnsupportedAssessment();
  }
  return assessSupport(detectBootCapabilities(), deviceHints());
}

function showUnsupported(assessment: SupportAssessment): void {
  document.body.setAttribute("data-support", "unsupported");
  const host = document.getElementById("support") ?? document.body;
  mountSupportScreen(host, assessment);
  window.apexStage = { support: assessment };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode / storage disabled — the store falls back to memory
  }
}

function bootGame(assessment: SupportAssessment): void {
  const quality = resolveQualityPreset(assessment);
  document.body.setAttribute("data-support", assessment.level);
  canvas.setAttribute("data-support", assessment.level);

  // Input abstraction + accessibility (#APEX-12). Settings load first and are
  // applied to the document root before anything paints; the input manager owns
  // the live binding table and feeds the telemetry harness a single command.
  const settingsStore = createLocalStorageStore(safeLocalStorage());
  let settings: GameSettings = settingsStore.load();
  const reducedMotionQuery = (): MediaQueryList | null =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const systemReducedMotion = systemPrefersReducedMotion(reducedMotionQuery);
  const applySettings = (next: GameSettings): void => {
    settings = next;
    settingsStore.save(next);
    applySettingsToDocument(document, next, systemReducedMotion);
    input.setBindings(next.input.bindings);
  };

  const isTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  const touch = isTouch ? createTouchControls(document.body, document) : null;
  touch?.setVisible(true);
  const input = createInputManager({
    bindings: settings.input.bindings,
    deadzone: settings.input.deadzone,
    touch,
  });
  applySettingsToDocument(document, settings, systemReducedMotion);

  const library = new StageLibrary();

  // #APEX-7: the two scenes have different shapes (stage select vs. race field);
  // they only share the engine's `SceneHandle` contract, so keep each narrow type
  // separately. `bootRace()` is skipped when the AI scene owns the clock.
  const raceParam = new URLSearchParams(window.location.search).get("race");
  const aiRaceId = raceParam && library.has(raceParam) ? raceParam : null;
  // Camera motion policy (#APEX-12): reduced motion zeroes shake/blur in the scene.
  const motion = motionPolicy(
    resolveMotionState(settings.accessibility.reducedMotion, systemReducedMotion),
  );
  const aiRace: AiRaceScene | null = aiRaceId
    ? createAiRaceScene(library.load(aiRaceId), { motion })
    : null;
  const motionBlur = aiRace ? mountMotionBlur(document.body, document) : null;
  const stageScene: StageSceneHandle | null = aiRace ? null : createStageScene(library);
  const sceneHandle: SceneHandle = aiRace ?? stageScene!;

  const catalog = library.list();
  const stageIds = catalog.map((entry) => entry.id);
  // #APEX-11: the selected stage drives the race definition (gates, reference
  // pace, opponents), so the run matches the card the player chose.
  const raceDefinitionFor = (id: string) =>
    toStageDefinition(library.load(id), catalog.find((entry) => entry.id === id)?.lengthM);

  // Stage race loop: countdown -> ordered checkpoints -> finish -> results. Gate
  // crossings are injected via the HUD's keyboard harness until in-world gate
  // detection lands; the race clock rides the engine's fixed step. Speed comes
  // from the shared input manager (#APEX-12) through the telemetry harness and
  // the minimap from the resolved stage world.
  const telemetry = createTelemetryHarness({ input: () => input.read() });
  let race: ReturnType<typeof bootRace> | null = null;
  if (!aiRace) {
    race = bootRace({
      telemetry,
      stage: raceDefinitionFor(stageScene!.current.id),
      minimap: stageScene!.world.minimap,
      // #APEX-11 owns stage selection: hide the HUD's built-in select panel.
      stageSelect: false,
      onNextStage: () => {
        if (!stageScene || !race) return;
        const next = nextStageId(stageIds, stageScene.current.id);
        stageScene.load(next);
        race.session.startWith(raceDefinitionFor(next));
      },
    });
  }

  // Co-driver pace notes (#APEX-18): derive once per stage from the sampled
  // centreline and advance the scheduler from the car harness position. The
  // optional voice reads the next note as it enters the lead window.
  const splineFor = (scene: StageSceneHandle) =>
    sampleSpline(scene.current.spline, scene.current.road.sampleStep);
  const notesFor = (scene: StageSceneHandle) =>
    buildPaceNotes(splineFor(scene), { checkpoints: scene.current.checkpoints });
  let paceSpline = stageScene ? splineFor(stageScene) : null;
  let paceTracker = stageScene ? new PaceNoteTracker(notesFor(stageScene)) : null;
  const voice = createSpeechVoice(window as unknown as SpeechSource);
  let voiceEnabled = settings.game.voice && voice.available;

  // Audio mix (#APEX-17): a pure model + a Web Audio port. Master mute/volume
  // persist through localStorage; the AudioContext unlocks on the first user
  // gesture (browser autoplay policy). Sampled loops come from the shared asset
  // pipeline (#APEX-6) — with none supplied the graph is structurally complete
  // but silent, and the game is unaffected.
  const audioStore = audioSettingsStore();
  let audioSettings: AudioSettings = loadAudioSettings(audioStore);
  const audio: AudioPort = createWebAudioPort(window as unknown as AudioContextSource, {
    maxOpponents: aiRace ? aiRace.carCount : 4,
  });
  audio.setSettings(audioSettings);
  const audioMixer = new AudioMixer();
  const audioEnv: EnvironmentAudioState = { wind01: 0, rain01: 0 };
  const unlockAudio = (): void => audio.unlock();
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  window.addEventListener("keydown", unlockAudio, { once: true });

  /** Settings mutations the menus (#APEX-11) call; each persists and re-applies. */
  const audioControls = {
    get settings(): AudioSettings {
      return audioSettings;
    },
    setMuted(muted: boolean): AudioSettings {
      audioSettings = setAudioMuted(audioStore, audioSettings, muted);
      audio.setSettings(audioSettings);
      return audioSettings;
    },
    setVolume(volume: number): AudioSettings {
      audioSettings = setAudioVolume(audioStore, audioSettings, volume);
      audio.setSettings(audioSettings);
      return audioSettings;
    },
  };

  // Load the compiled sampled loops (#APEX-6 pipeline) and hand them to the port.
  // Non-blocking and best-effort: while it resolves (and if it ever fails) the
  // mix is silent but the race runs. Decoded buffers are started by `unlock()`
  // (or immediately if the player already gestured).
  const loadGameAudio = async (): Promise<void> => {
    try {
      const manifestUrl = resolveAudioUrl("assets/manifest.json", document.baseURI);
      const response = await fetch(manifestUrl);
      if (!response.ok) return;
      const manifest = (await response.json()) as AudioManifest;
      const busAssets = await loadAudioBusAssets(manifest, (data) => audio.decode(data), {
        base: document.baseURI,
      });
      audio.setAssets(busAssets);
    } catch {
      // No manifest/assets or offline: stay silent, never break the boot.
    }
  };
  void loadGameAudio();

  const syncVoice = (): void => {
    race?.hud.setVoice({
      available: voice.available,
      enabled: voiceEnabled,
      onToggle: (enabled) => {
        voiceEnabled = enabled;
        if (!enabled) voice.cancel();
      },
    });
  };
  if (race && paceTracker) {
    race.hud.setPaceNotes(() => paceTracker!.view());
    syncVoice();
  }

  // Settings surfaces: #APEX-12's panel (bindings/a11y) and #APEX-11's menu
  // (game prefs). Both write the ONE shared store; this fans a change out to
  // every consumer (document, bindings, menu, panel, co-driver voice).
  let menu: MenuHandle | null = null;
  let settingsPanel: SettingsPanelHandle | null = null;
  const onSettingsChange = (next: GameSettings): void => {
    applySettings(next);
    menu?.setSettings(next);
    settingsPanel?.update(next);
    voiceEnabled = next.game.voice && voice.available;
    syncVoice();
    if (!voiceEnabled) voice.cancel();
  };

  // Keep the minimap and pace notes in sync when the stage select swaps circuit.
  let currentCircuitId = stageScene?.current.id ?? "";
  const syncMinimap = (): void => {
    if (!race || !stageScene) return;
    if (stageScene.current.id !== currentCircuitId) {
      currentCircuitId = stageScene.current.id;
      paceSpline = splineFor(stageScene);
      paceTracker = new PaceNoteTracker(notesFor(stageScene));
      race.hud.setMinimap(stageScene.world.minimap);
    }
  };

  // First-run tutorial (#APEX-11): optional driving lessons gated on the player
  // performing each action. Pure `TutorialModel` + a thin DOM overlay.
  let tutorial: TutorialModel | null = null;
  let tutorialOverlay: TutorialOverlayHandle | null = null;
  let tutorialInput: InputSource | null = null;
  let tutorialActive = false;
  let tutorialFinishing = false;

  function endTutorial(markSeen = true): void {
    if (!tutorialActive && !tutorialFinishing) return;
    tutorialActive = false;
    tutorialFinishing = false;
    tutorialInput?.dispose();
    tutorialInput = null;
    tutorialOverlay?.dispose();
    tutorialOverlay = null;
    if (markSeen) {
      onSettingsChange({
        ...settings,
        game: { ...settings.game, tutorialSeen: true },
      });
    }
    if (menu) {
      menu.element.hidden = false;
      menu.showScreen("home");
    }
  }

  function startTutorial(): void {
    if (aiRace || !menu) return;
    tutorial = new TutorialModel();
    tutorialOverlay = mountTutorialOverlay(document.body, () => endTutorial());
    tutorialInput = createKeyboardInput(window as unknown as KeyboardTarget);
    tutorialActive = true;
    tutorialFinishing = false;
    menu.element.hidden = true;
    tutorialOverlay.update(tutorial);
    tutorialOverlay.focus();
  }

  const app: EngineApp = createEngine(canvas, {
    sceneHandle,
    renderer: { quality, maxPixelRatio: quality.maxPixelRatio },
    onUpdate: race
      ? (dt) => {
          race.update(dt);
          if (tutorialActive && tutorial && tutorialInput && tutorialOverlay) {
            const advanced = tutorial.observe(tutorialInput.read(), telemetry.read().speedKmh);
            if (advanced) {
              tutorialOverlay.update(tutorial);
              // Let the "Tutorial complete" state paint before closing.
              if (tutorial.complete && !tutorialFinishing) {
                tutorialFinishing = true;
                window.setTimeout(() => endTutorial(), 1200);
              }
            }
          }
          if (paceTracker && race.session.phase === "countdown") paceTracker.reset();
          let distance: number | null = null;
          if (paceTracker && paceSpline && telemetry.position) {
            const position = telemetry.position();
            distance = nearestDistanceOnSpline(paceSpline, position.x, position.z);
            paceTracker.setDistance(distance);
          }
          // Drive the mix from the car harness. rpm/load are derived from speed
          // and the surface from the stage's surface spans at the car's
          // arc-length, until in-world telemetry lands (same interim pattern as
          // gate crossings); environment state defaults dry until #APEX-29.
          const speed01 = Math.min(1, Math.max(0, telemetry.read().speedKmh / 200));
          const surface =
            stageScene && paceSpline && distance !== null
              ? physicsSurfaceAt(stageScene.current, distance / paceSpline.length).id
              : "tarmac";
          const carState: CarAudioState = {
            rpm01: speed01,
            load01: Math.min(1, speed01 * 1.2),
            speed01,
            // No slip telemetry in the harness yet; scale with speed so the tyre
            // bus is audible and the per-surface timbre is distinguishable.
            slip01: Math.min(1, speed01 * 0.7),
            surface,
            impact01: 0,
          };
          const mix = audioMixer.step(carState, audioEnv, dt);
          const carPosition = telemetry.position?.() ?? null;
          audio.update(mix, carPosition ? listenerFromCar(carPosition) : { x: 0, y: 0, z: 0, yaw: 0 });
        }
      : undefined,
    onRender: aiRace
      ? () => {
          // Speed motion blur (#APEX-12); hidden by CSS under reduced motion.
          motionBlur?.setStrength(aiRace.cameraEffects().blur);
        }
      : race
        ? () => {
            syncMinimap();
            race.render();
            if (voiceEnabled && race.session.phase === "racing") {
              const note = paceTracker?.pollAnnouncement();
              if (note) voice.speak(note.call);
            }
          }
        : undefined,
  });
  app.start();

  // Accessibility + controls settings surface (#APEX-12). Mounted on both paths;
  // changes are persisted and applied live (palette, motion, text scale, bindings).
  settingsPanel = mountSettingsPanel(document.body, { settings, onChange: onSettingsChange });

  if (!aiRace) {
    const menuHost = document.getElementById("menu") ?? document.body;
    menu = mountMenu(menuHost, catalog, settings, {
      onStageSelected: (id) => stageScene!.load(id),
      onRace: (id) => {
        stageScene!.load(id);
        race!.session.startWith(raceDefinitionFor(id));
      },
      onSettingsChange: (next) => onSettingsChange(next),
      onTutorial: () => startTutorial(),
    });

    // The menu is visible exactly while the race is not running (stage_select).
    // Quitting a run returns here; per #APEX-11/L2 the menu resets to home and
    // clears the prior selection rather than showing stale state.
    race!.session.subscribe((controller) => {
      if (!menu || tutorialActive) return;
      race!.hud.setKeyboardEnabled(controller.phase !== "stage_select");
      if (controller.phase === "stage_select") {
        menu.reset();
        menu.element.hidden = false;
      } else {
        menu.element.hidden = true;
      }
    });

    window.apexStage = {
      library,
      scene: stageScene!,
      app,
      race: race!,
      support: assessment,
      quality,
      /** Input abstraction (#APEX-12), exposed for tooling + evidence. */
      input,
      pace: { get tracker() { return paceTracker; }, voice },
      menu,
      get settings() { return settings; },
      startTutorial,
      get tutorial() { return tutorial; },
      audio: { port: audio, controls: audioControls, mixer: audioMixer, env: audioEnv },
    };
  } else {
    window.apexRace = { library, scene: aiRace, app };
  }

  // Vite HMR: release GPU + overlay resources before the module is replaced.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      audio.dispose();
      voice.cancel();
      tutorialInput?.dispose();
      tutorialOverlay?.dispose();
      menu?.dispose();
      race?.dispose();
      settingsPanel?.dispose();
      motionBlur?.dispose();
      input.dispose();
      app.dispose();
    });
  }
}

const assessment = resolveAssessment();
if (assessment.level === "unsupported") {
  showUnsupported(assessment);
} else {
  try {
    bootGame(assessment);
  } catch (error) {
    showUnsupported({
      ...assessment,
      level: "unsupported",
      reason: `Apex Rally failed to start: ${String(error)}`,
      missing: ["WebGL2"],
    });
  }
}

declare global {
  interface Window {
    /** Exposed for tooling, the smoke test and screenshot evidence scripts. */
    apexStage?: {
      library?: StageLibrary;
      scene?: StageSceneHandle;
      app?: EngineApp;
      race?: ReturnType<typeof bootRace>;
      support: SupportAssessment;
      quality?: ReturnType<typeof resolveQualityPreset>;
      /** Input abstraction (#APEX-12), exposed for tooling + evidence. */
      input?: InputManager;
      /** Co-driver pace-note state (#APEX-18), exposed for tooling + evidence. */
      pace?: { tracker: PaceNoteTracker | null; voice: Voice };
      /** Menus (#APEX-11), exposed for the smoke test + screenshot evidence. */
      menu?: MenuHandle;
      /** Live settings snapshot (#APEX-11), exposed for evidence scripts. */
      settings?: GameSettings;
      /** Start the first-run tutorial (#APEX-11). */
      startTutorial?: () => void;
      /** Live tutorial state (#APEX-11), exposed for evidence scripts. */
      tutorial?: TutorialModel | null;
      /** Dynamic car/environment audio mix (#APEX-17), exposed for tooling + evidence. */
      audio?: {
        port: AudioPort;
        mixer: AudioMixer;
        env: EnvironmentAudioState;
        controls: {
          readonly settings: AudioSettings;
          setMuted(muted: boolean): AudioSettings;
          setVolume(volume: number): AudioSettings;
        };
      };
    };
    /** Exposed when running the visible CPU race (`?race=<id>`). */
    apexRace?: { library: StageLibrary; scene: AiRaceScene; app: EngineApp } | null;
  }
}
