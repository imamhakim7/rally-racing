/**
 * Deterministic headless race harness (#APEX-9). Node-only.
 *
 * A thin wrapper over the browser-safe {@link captureRace} that adds the trace's
 * SHA-256 content hash. Two runs — in the same process or in separate processes,
 * with no GPU and no wall clock — produce the same trace bytes and the same
 * hash; that equality is what the CI determinism job asserts.
 */
import { captureRace, type CaptureRaceOptions, type CapturedRace, type HarnessSplit } from "./capture";
import { traceHash } from "./replay";
import type { RaceTrace } from "./trace";
import type { StageLibrary } from "../stage/library";
import type { StageCircuit } from "../stage/types";

export type HeadlessRaceOptions = CaptureRaceOptions;

export interface HeadlessRace extends CapturedRace {
  /** SHA-256 of the canonical trace bytes. Equal runs ⇒ equal hash. */
  hash: string;
}

/** Run one deterministic race, capture its trace, and hash it. */
export function runHeadlessRace(
  circuit: StageCircuit,
  options: HeadlessRaceOptions = {},
): HeadlessRace {
  const captured = captureRace(circuit, options);
  return { ...captured, hash: traceHash(captured.trace) };
}

/** Convenience: load a stage from a {@link StageLibrary} then race it headlessly. */
export function runHeadlessRaceFromLibrary(
  library: StageLibrary,
  stageId: string,
  options: HeadlessRaceOptions = {},
): HeadlessRace {
  return runHeadlessRace(library.load(stageId), options);
}

export { FINISH_SPLIT_ID } from "./capture";
export type { HarnessSplit };
export type { RaceTrace };
