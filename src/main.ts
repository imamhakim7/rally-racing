import { createEngine, type EngineApp } from "./engine";
import {
  StageLibrary,
  createStageScene,
  mountStageSelect,
  type StageSceneHandle,
} from "./stage";

/**
 * Browser entry point. Boots the engine with the stage scene and wires the
 * (minimal) stage select. All simulation lives in `src/engine`; stage data and
 * world building live in `src/stage`; this file only touches the DOM.
 *
 * Integration note: the vehicle (#APEX-2, `src/physics`) and the race loop
 * (#APEX-3) consume the resolved `StageWorld` (surface zones, gate transforms,
 * spline) — they are not yet placed on the stage in the browser entry, which
 * this ticket leaves to the integration tickets. The physics module and its
 * tests are unchanged.
 */
const canvas = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}

const library = new StageLibrary();
const sceneHandle: StageSceneHandle = createStageScene(library);
const app: EngineApp = createEngine(canvas, { sceneHandle });
app.start();

const selectHost = document.getElementById("stage-select");
if (selectHost) {
  mountStageSelect(selectHost, library, sceneHandle);
}

declare global {
  interface Window {
    /** Exposed for tooling and the screenshot evidence script. */
    apexStage?: { library: StageLibrary; scene: StageSceneHandle; app: EngineApp };
  }
}
window.apexStage = { library, scene: sceneHandle, app };

// Vite HMR: release GPU resources before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
