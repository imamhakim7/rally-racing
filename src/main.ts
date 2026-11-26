import { createEngine, type EngineApp } from "./engine";

/**
 * Browser entry point. Grabs the single boot canvas and starts the engine.
 * All simulation lives in `src/engine`; this file only wires the DOM lifecycle.
 */
const canvas = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}

const app: EngineApp = createEngine(canvas);
app.start();

// Vite HMR: release GPU resources before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
