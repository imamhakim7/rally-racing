/**
 * HUD view model — the DOM-free projection behind `RaceHud`.
 *
 * `RaceHud` paints; this module decides *what* to paint so the exact strings,
 * split direction, projected position, minimap dot and screen-reader summary
 * can be asserted in a headless (node) unit test. It reads the authoritative
 * `RaceController` and a small `HudTelemetry` snapshot and never mutates them.
 */
import type { RaceController } from "./race";
import { formatDelta, formatSpeed, formatTime, splitDelta } from "./results";
import type { PaceNoteView } from "./pace-notes";
import type { RacePhase } from "./types";

/** Per-frame telemetry the HUD needs from the vehicle (or a harness). */
export interface HudTelemetry {
  /** Ground speed in km/h. */
  speedKmh: number;
}

/** Which way a split delta leans, for colour + glyph (never colour alone). */
export type SplitDirection = "ahead" | "behind" | "even";

export interface HudSplit {
  /** Signed seconds, e.g. `-0.482` / `+1.204`. */
  text: string;
  direction: SplitDirection;
  /** Redundant non-colour glyph: `▼` ahead, `▲` behind, `=` even. */
  glyph: string;
}

export interface HudState {
  phase: RacePhase;
  /** Rounded km/h without the unit, e.g. `"128"`. */
  speedText: string;
  /** Total race time including penalties, e.g. `"1:07.482"`. */
  timeText: string;
  /** `"P2"` while a position is known, otherwise `"P–"`. */
  positionText: string;
  /** Next checkpoint name, or `"to finish"`. */
  nextText: string;
  /** Delta at the most recent split, or `null` when there is none. */
  split: HudSplit | null;
  /** Normalised (0..1) minimap dot for the player, or `null` without a path. */
  progress: { x: number; y: number } | null;
  /** Full race-state sentence for the polite live region. */
  srSummary: string;
  /** Coarse change key: the live region is written only when this changes. */
  srKey: string;
}

/** Anything with `x`/`y` in normalised minimap space. */
export interface MinimapPoint {
  x: number;
  y: number;
}

const EPSILON = 0.0005;

/**
 * Point along a resolved minimap path at `ratio` (0..1), sampled from the same
 * centreline the road uses. Endpoints are exact; `null` for an empty path.
 */
export function minimapDot(
  points: readonly MinimapPoint[],
  ratio: number,
): { x: number; y: number } | null {
  if (points.length === 0) return null;
  if (!Number.isFinite(ratio)) return { x: points[0]!.x, y: points[0]!.y };
  const clamped = Math.min(1, Math.max(0, ratio));
  const index = Math.round(clamped * (points.length - 1));
  const point = points[index]!;
  return { x: point.x, y: point.y };
}

function splitDirection(delta: number): SplitDirection {
  if (delta < -EPSILON) return "ahead";
  if (delta > EPSILON) return "behind";
  return "even";
}

function glyphFor(direction: SplitDirection): string {
  if (direction === "ahead") return "▼";
  if (direction === "behind") return "▲";
  return "=";
}

function positionLabel(position: number | null): string {
  return position === null ? "P–" : `P${position}`;
}

/** Project the controller + telemetry into the strings the overlay paints. */
export function buildHudState(
  controller: RaceController,
  telemetry: HudTelemetry | null,
  minimap: readonly MinimapPoint[] = [],
): HudState {
  const phase = controller.phase;
  const speedText = telemetry ? formatSpeed(telemetry.speedKmh) : "–";
  const totalSeconds = controller.elapsed + controller.penaltySeconds;
  const timeText = formatTime(totalSeconds);
  const nextText = controller.nextCheckpoint?.name ?? "to finish";
  const dot = minimapDot(minimap, controller.progressRatio);

  const lastSplit = controller.lastSplit;
  const delta = lastSplit ? splitDelta(lastSplit, controller.stage?.referenceSplits) : null;
  const split: HudSplit | null =
    delta === null
      ? null
      : (() => {
          const direction = splitDirection(delta);
          return { text: formatDelta(delta), direction, glyph: glyphFor(direction) };
        })();

  const result = controller.result;
  const finishedValid = (phase === "finished" || phase === "invalidated") && result?.valid === true;
  const position =
    phase === "racing" ? controller.projectedPosition : finishedValid ? result!.position : null;
  const positionText =
    phase === "finished" || phase === "invalidated"
      ? finishedValid
        ? positionLabel(result!.position)
        : "P–"
      : positionLabel(position);

  const progress = phase === "racing" ? dot : null;

  return {
    phase,
    speedText,
    timeText,
    positionText,
    nextText,
    split,
    progress,
    srSummary: buildSummary(phase, telemetry, timeText, positionText, nextText, split, finishedValid, result?.totalTime),
    srKey: buildSrKey(phase, controller, telemetry, positionText, finishedValid),
  };
}

function buildSummary(
  phase: RacePhase,
  telemetry: HudTelemetry | null,
  timeText: string,
  positionText: string,
  nextText: string,
  split: HudSplit | null,
  finishedValid: boolean,
  resultTotal: number | undefined,
): string {
  if (phase === "stage_select") return "Stage select. Choose a stage and press Start.";
  if (phase === "countdown") return "Countdown. Get ready.";
  if (phase === "finished" || phase === "invalidated") {
    if (!finishedValid) return "Run invalidated. Too many checkpoints missed.";
    return `Finished. Position ${positionText.replace("P", "")}, total time ${formatTime(resultTotal ?? 0)}.`;
  }
  const speed = telemetry ? `Speed ${formatSpeed(telemetry.speedKmh)} kilometres per hour.` : "Speed unknown.";
  const parts = [
    `Racing. Time ${timeText}.`,
    `Position ${positionText === "P–" ? "unknown" : positionText.replace("P", "")}.`,
    speed,
    `Next gate ${nextText}.`,
  ];
  if (split) {
    parts.push(
      split.direction === "ahead"
        ? `Ahead of pace by ${split.text.replace("-", "")} seconds.`
        : split.direction === "behind"
          ? `Behind pace by ${split.text.replace("+", "")} seconds.`
          : "On pace.",
    );
  }
  return parts.join(" ");
}

/** Coarse key so the live region is not re-announced every frame. */
function buildSrKey(
  phase: RacePhase,
  controller: RaceController,
  telemetry: HudTelemetry | null,
  positionText: string,
  finishedValid: boolean,
): string {
  if (phase === "finished" || phase === "invalidated") {
    return `${phase}|${finishedValid ? controller.result?.position ?? "" : "invalid"}`;
  }
  const splitIndex = controller.lastSplit?.index ?? -1;
  const timeBucket = Math.floor((controller.elapsed + controller.penaltySeconds) / 5);
  const speed = telemetry && Number.isFinite(telemetry.speedKmh) ? telemetry.speedKmh : -1;
  const speedBucket = Math.round(speed / 20);
  return `${phase}|${splitIndex}|${positionText}|${timeBucket}|${speedBucket}`;
}

/**
 * The HUD projection of the co-driver's pace notes (#APEX-18).
 *
 * Pure strings so the panel's semantics are unit-tested headlessly; the DOM
 * overlay only paints. `visible` is false when the stage has no notes, so the
 * panel hides rather than showing an empty call.
 */
export interface HudPaceNotes {
  visible: boolean;
  /** The next corner's phrase, e.g. `"Right 3"`. */
  nextCall: string;
  /** Distance to the next corner rounded to metres, e.g. `"240 m"`. */
  nextDistance: string;
  /** The following up to `maxFollowing` calls, e.g. `["Left 5", "Right 2"]`. */
  following: string[];
  /** Whether a note is actually ahead (vs. the stage merely having notes). */
  hasNext: boolean;
  /** Sentence for the polite live region / screen reader. */
  srText: string;
}

export function buildPaceNoteHud(
  view: PaceNoteView | null,
  maxFollowing = 3,
): HudPaceNotes {
  if (!view || !view.hasNotes) {
    return {
      visible: false,
      nextCall: "",
      nextDistance: "",
      following: [],
      hasNext: false,
      srText: "",
    };
  }

  const next = view.next;
  const following = view.upcoming
    .slice(1, 1 + Math.max(0, maxFollowing))
    .map((note) => note.call);

  if (!next) {
    return {
      visible: true,
      nextCall: "Clear",
      nextDistance: "",
      following,
      hasNext: false,
      srText: "No notes ahead.",
    };
  }

  const metres = Math.max(0, Math.round(view.nextDistance ?? 0));
  return {
    visible: true,
    nextCall: next.call,
    nextDistance: `${metres} m`,
    following,
    hasNext: true,
    srText: `Next note ${next.call} in ${metres} metres.`,
  };
}
