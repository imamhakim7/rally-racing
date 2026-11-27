/**
 * Adapter to the race-loop contract (#APEX-3).
 *
 * The race loop does not import this module and we do not import the race loop:
 * both agree on a small structural shape. That keeps APEX-4 deliverable while
 * APEX-3 is still in flight, and the mapping lives next to the data it reads.
 */
import type { RaceStageShape, StageCircuit } from "./types";

/**
 * Project a circuit into the ordered gate list the race loop consumes: one entry
 * per checkpoint (0-based `index`) plus a final `finish` gate.
 */
export function toRaceStage(circuit: StageCircuit): RaceStageShape {
  const checkpoints = circuit.checkpoints.map((checkpoint, index) => ({
    id: checkpoint.id,
    index,
    name: checkpoint.name,
  }));
  return {
    id: circuit.id,
    name: circuit.name,
    checkpoints,
    finishId: "finish",
    gateCount: checkpoints.length + 1,
  };
}
