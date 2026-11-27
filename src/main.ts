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
  mountStageSelect,
  type StageSceneHandle,
} from "./stage";
import { bootRace, createTelemetryHarness } from "./race";
import { mountSupportScreen } from "./ui/supportScreen";
import { createAiRaceScene, type AiRaceScene } from "./scenes/aiRaceScene";

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

function bootGame(assessment: SupportAssessment): void {
  const quality = resolveQualityPreset(assessment);
  document.body.setAttribute("data-support", assessment.level);
  canvas.setAttribute("data-support", assessment.level);

  const library = new StageLibrary();
  // #APEX-7: the two scenes have different shapes (stage select vs. race field);
  // they only share the engine's `SceneHandle` contract, so keep each narrow type
  // separately. `bootRace()` is skipped when the AI scene owns the clock.
  const raceParam = new URLSearchParams(window.location.search).get("race");
  const aiRaceId = raceParam && library.has(raceParam) ? raceParam : null;
  const aiRace: AiRaceScene | null = aiRaceId ? createAiRaceScene(library.load(aiRaceId)) : null;
  const stageScene: StageSceneHandle | null = aiRace ? null : createStageScene(library);
  const sceneHandle: SceneHandle = aiRace ?? stageScene!;

  // Stage race loop: countdown -> ordered checkpoints -> finish -> results. Gate
  // crossings are injected via the HUD's keyboard harness until in-world gate
  // detection lands; the race clock rides the engine's fixed step. Speed comes
  // from a keyboard-driven vehicle harness (same interim pattern) and the
  // minimap from the resolved stage world.
  const telemetry = createTelemetryHarness();
  const race = aiRace ? null : bootRace({ telemetry, minimap: stageScene!.world.minimap });

  // Keep the minimap in sync when the stage select swaps the circuit.
  let minimapCircuitId = stageScene?.current.id ?? "";
  const syncMinimap = (): void => {
    if (!race || !stageScene) return;
    if (stageScene.current.id !== minimapCircuitId) {
      minimapCircuitId = stageScene.current.id;
      race.hud.setMinimap(stageScene.world.minimap);
    }
  };

  const app: EngineApp = createEngine(canvas, {
    sceneHandle,
    renderer: { quality, maxPixelRatio: quality.maxPixelRatio },
    onUpdate: race ? (dt) => race.update(dt) : undefined,
    onRender: race
      ? () => {
          syncMinimap();
          race.render();
        }
      : undefined,
  });
  app.start();

  if (!aiRace) {
    const selectHost = document.getElementById("stage-select");
    if (selectHost) {
      mountStageSelect(selectHost, library, stageScene!);
    }
    window.apexStage = { library, scene: stageScene!, app, race: race!, support: assessment, quality };
  } else {
    window.apexRace = { library, scene: aiRace, app };
  }

  // Vite HMR: release GPU + overlay resources before the module is replaced.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      race?.dispose();
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
    };
    /** Exposed when running the visible CPU race (`?race=<id>`). */
    apexRace?: { library: StageLibrary; scene: AiRaceScene; app: EngineApp } | null;
  }
}
