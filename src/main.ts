import { createEngine, type EngineApp } from "./engine";
import { createKeyboardInput, type KeyboardTarget } from "./input/keyboard";
import { createPhysicsTestScene } from "./scenes/physicsTestScene";
import { createDebugOverlay } from "./ui/debugOverlay";

/**
 * Browser entry point. Boots the engine against the physics test scene, feeds it
 * keyboard input and mirrors the live telemetry into a debug overlay.
 */
const canvas = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Apex Rally boot failed: <canvas id=\"app\"> not found.");
}

const overlayEl = document.createElement("pre");
overlayEl.id = "debug-overlay";
overlayEl.setAttribute("aria-label", "Vehicle debug overlay");
Object.assign(overlayEl.style, {
  position: "fixed",
  top: "12px",
  left: "12px",
  margin: "0",
  padding: "10px 12px",
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#d7e2f0",
  background: "rgba(11, 14, 19, 0.72)",
  border: "1px solid rgba(142, 163, 106, 0.4)",
  borderRadius: "6px",
  pointerEvents: "none",
  whiteSpace: "pre",
});
document.body.appendChild(overlayEl);

const keyboard = createKeyboardInput(window as unknown as KeyboardTarget);
const overlay = createDebugOverlay(overlayEl);

const sceneHandle = createPhysicsTestScene({
  input: () => keyboard.read(),
  onTelemetry: (telemetry, surface) => overlay.update(telemetry, surface),
});

// Hint text so a first-time player knows the controls.
const hint = document.createElement("div");
hint.textContent = "W/S drive · A/D steer · Space handbrake";
Object.assign(hint.style, {
  position: "fixed",
  bottom: "12px",
  left: "12px",
  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#9fb0c4",
  pointerEvents: "none",
});
document.body.appendChild(hint);

const app: EngineApp = createEngine(canvas, { sceneHandle });
app.start();

// Vite HMR: release GPU/input resources before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
    keyboard.dispose();
    overlay.dispose();
    overlayEl.remove();
    hint.remove();
  });
}
