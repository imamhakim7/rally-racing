export { RaceController, type RaceControllerOptions } from "./race";
export { StageSession, type RaceListener } from "./session";
export { RaceHud, type RaceHudHandlers, type HudMinimap } from "./hud";
export {
  buildHudState,
  minimapDot,
  type HudState,
  type HudSplit,
  type HudTelemetry,
  type SplitDirection,
} from "./hud-model";
export { createTelemetryHarness, type TelemetryFeed, type TelemetryHarnessOptions } from "./telemetry";
export { createDemoStage, defineStage } from "./stage";
export {
  formatDelta,
  formatSpeed,
  formatTime,
  playerPosition,
  positionForTime,
  rankStandings,
  referenceTimeAt,
  splitDelta,
  sumSplits,
} from "./results";
export type {
  CheckpointDef,
  OpponentDef,
  RacePhase,
  RaceResult,
  ReferenceSplit,
  Split,
  StageDefinition,
  Standing,
} from "./types";

import { RaceHud, type HudMinimap, type RaceHudHandlers } from "./hud";
import { StageSession } from "./session";
import { createDemoStage } from "./stage";
import type { TelemetryFeed } from "./telemetry";
import type { StageDefinition } from "./types";
import type { RaceControllerOptions } from "./race";

export interface RaceBootOptions extends RaceControllerOptions {
  /** Stage to load; defaults to the bundled demo stage. */
  stage?: StageDefinition;
  /** Where to mount the HUD overlay (defaults to `document.body`). */
  hudRoot?: HTMLElement;
  /** Speed telemetry source for the HUD (absent = speed shown as `–`). */
  telemetry?: TelemetryFeed;
  /** Circuit minimap path from `StageWorld` (absent = no minimap). */
  minimap?: HudMinimap | null;
}

export interface RaceBoot {
  session: StageSession;
  hud: RaceHud;
  /** Advance the race clock by one fixed step (wire into the engine). */
  update: (dt: number) => void;
  /** Render the overlay (call every frame). */
  render: () => void;
  dispose: () => void;
}

/**
 * Compose a playable stage: a `StageSession` plus its `RaceHud`, with keyboard
 * gate crossings. Returns `update`/`render` hooks for the engine composition
 * root and a `dispose` that tears the overlay down.
 */
export function bootRace(options: RaceBootOptions = {}): RaceBoot {
  const session = new StageSession(options.stage ?? createDemoStage(), {
    maxDelta: options.maxDelta,
    playerName: options.playerName,
  });

  const handlers: RaceHudHandlers = {
    onStart: () => session.start(),
    onRestart: () => session.restart(),
    onQuit: () => session.quit(),
    onCrossGate: (gateId) => session.crossGate(gateId),
  };
  const hud = new RaceHud(handlers);
  hud.setTelemetry(options.telemetry ? () => options.telemetry!.read() : null);
  hud.setMinimap(options.minimap ?? null);
  if (typeof document !== "undefined") {
    hud.mount(options.hudRoot ?? document.body);
    hud.render(session.controller);
  }

  return {
    session,
    hud,
    update: (dt) => {
      options.telemetry?.update(dt);
      session.update(dt);
      hud.render(session.controller);
    },
    render: () => hud.render(session.controller),
    dispose: () => {
      options.telemetry?.dispose();
      hud.dispose();
    },
  };
}
