import { createEngine, type EngineApp, type SceneHandle } from "./engine";
import {
  StageLibrary,
  createStageScene,
  mountStageSelect,
  type StageSceneHandle,
} from "./stage";
import { bootRace } from "./race";
import { createAiRaceScene, type AiRaceScene } from "./scenes/aiRaceScene";

/**
 * Browser entry point. Boots the engine with the stage scene and wires the
 * (minimal) stage select, then layers the stage race loop on top. With
 * `?race=<stageId>` it boots the visible CPU race scene (#APEX-7) instead.
 *
 * All simulation lives in `src/engine` / `src/ai`; stage data and world building
 * live in `src/stage`; race state lives in `src/race`. The engine's fixed-timestep
 * loop drives everything through one clock: the scene (via `sceneHandle.update`)
 * and, when present, the #APEX-3 race loop (via `onUpdate`), so world physics and
 * race timing stay frame-rate independent and in lockstep.
 *
 * Integration note: the vehicle (#APEX-2, `src/physics`) consumes the resolved
 * `StageWorld` (surface zones, gate transforms, spline); in-world gate detection
 * for the race loop is left to a later integration ticket, so the race HUD hosts
 * a keyboard harness for crossings (see `docs/openspecs/APEX-3.md` non-goals).
 * The `?race=` scene is the watchable CPU race from #APEX-7 (evidence/playtest).
 */
const canvas = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}

const library = new StageLibrary();
const raceParam = new URLSearchParams(window.location.search).get("race");
const aiRaceId = raceParam && library.has(raceParam) ? raceParam : null;
const aiRace: AiRaceScene | null = aiRaceId ? createAiRaceScene(library.load(aiRaceId)) : null;
// The two scenes have different shapes (stage select vs. race field); they only
// share the engine's `SceneHandle` contract, so keep each narrow type separately.
const stageScene: StageSceneHandle | null = aiRace ? null : createStageScene(library);
const sceneHandle: SceneHandle = aiRace ?? stageScene!;

// Stage race loop: countdown -> ordered checkpoints -> finish -> results. Gate
// crossings are injected via the HUD's keyboard harness until in-world gate
// detection lands; the race clock rides the engine's fixed step. Skipped when the
// AI race scene owns the clock.
const race = aiRace ? null : bootRace();

const app: EngineApp = createEngine(canvas, {
  sceneHandle,
  onUpdate: race ? (dt) => race.update(dt) : undefined,
  onRender: race ? () => race.render() : undefined,
});
app.start();

if (!aiRace) {
  const selectHost = document.getElementById("stage-select");
  if (selectHost) {
    mountStageSelect(selectHost, library, stageScene!);
  }
}

declare global {
  interface Window {
    /** Exposed for tooling and the screenshot evidence scripts. */
    apexStage?: {
      library: StageLibrary;
      scene: StageSceneHandle;
      app: EngineApp;
      race: ReturnType<typeof bootRace>;
    };
    /** Exposed when running the visible CPU race (`?race=<id>`). */
    apexRace?: { library: StageLibrary; scene: AiRaceScene; app: EngineApp } | null;
  }
}
if (aiRace) {
  window.apexRace = { library, scene: aiRace, app };
} else {
  window.apexStage = { library, scene: stageScene!, app, race: race! };
}

// Vite HMR: release GPU + overlay resources before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    race?.dispose();
    app.dispose();
  });
}
