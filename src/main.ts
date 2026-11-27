import { createEngine, type EngineApp } from "./engine";
import {
  StageLibrary,
  createStageScene,
  mountStageSelect,
  type StageSceneHandle,
} from "./stage";
import { bootRace } from "./race";

/**
 * Browser entry point. Boots the engine with the stage scene and wires the
 * (minimal) stage select, then layers the stage race loop on top.
 *
 * All simulation lives in `src/engine`; stage data and world building live in
 * `src/stage`; race state lives in `src/race`. The engine's fixed-timestep loop
 * drives everything through one clock: the scene (via `sceneHandle.update`) and
 * the race loop (via `onUpdate`), so world physics and race timing stay
 * frame-rate independent and in lockstep.
 *
 * Integration note: the vehicle (#APEX-2, `src/physics`) consumes the resolved
 * `StageWorld` (surface zones, gate transforms, spline); in-world gate detection
 * for the race loop is left to a later integration ticket, so the race HUD hosts
 * a keyboard harness for crossings (see `docs/openspecs/APEX-3.md` non-goals).
 */
const canvas = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}

const library = new StageLibrary();
const sceneHandle: StageSceneHandle = createStageScene(library);

// Stage race loop: countdown -> ordered checkpoints -> finish -> results. Gate
// crossings are injected via the HUD's keyboard harness until in-world gate
// detection lands; the race clock rides the engine's fixed step.
const race = bootRace();

const app: EngineApp = createEngine(canvas, {
  sceneHandle,
  onUpdate: (dt) => race.update(dt),
  onRender: () => race.render(),
});
app.start();

const selectHost = document.getElementById("stage-select");
if (selectHost) {
  mountStageSelect(selectHost, library, sceneHandle);
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
  }
}
window.apexStage = { library, scene: sceneHandle, app, race };

// Vite HMR: release GPU + overlay resources before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    race.dispose();
    app.dispose();
  });
}
