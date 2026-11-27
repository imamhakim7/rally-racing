export { RaceController, type RaceControllerOptions } from "./race";
export { StageSession, type RaceListener } from "./session";
export { RaceHud, type RaceHudHandlers } from "./hud";
export { createDemoStage, defineStage } from "./stage";
export { formatTime, playerPosition, rankStandings, sumSplits } from "./results";
export type {
  CheckpointDef,
  OpponentDef,
  RacePhase,
  RaceResult,
  Split,
  StageDefinition,
  Standing,
} from "./types";

import { RaceHud, type RaceHudHandlers } from "./hud";
import { StageSession } from "./session";
import { createDemoStage } from "./stage";
import type { StageDefinition } from "./types";
import type { RaceControllerOptions } from "./race";

export interface RaceBootOptions extends RaceControllerOptions {
  /** Stage to load; defaults to the bundled demo stage. */
  stage?: StageDefinition;
  /** Where to mount the HUD overlay (defaults to `document.body`). */
  hudRoot?: HTMLElement;
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
  if (typeof document !== "undefined") {
    hud.mount(options.hudRoot ?? document.body);
    hud.render(session.controller);
  }

  return {
    session,
    hud,
    update: (dt) => {
      session.update(dt);
      hud.render(session.controller);
    },
    render: () => hud.render(session.controller),
    dispose: () => hud.dispose(),
  };
}
