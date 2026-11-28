/**
 * Adapter to the race-loop contract (#APEX-3).
 *
 * The race loop does not import this module and we do not import the race loop:
 * both agree on a small structural shape. That keeps APEX-4 deliverable while
 * APEX-3 is still in flight, and the mapping lives next to the data it reads.
 */
import type { RaceStageShape, StageCircuit } from "./types";
import type { StageDefinition } from "../race/types";

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

/** Rally target pace used to synthesise a reference time for a stage. */
const AVERAGE_SPEED_MPS = 18;
const MIN_TARGET_SECONDS = 20;

function referenceTargets(circuit: StageCircuit, target: number): StageDefinition["referenceSplits"] {
  const ordered = [...circuit.checkpoints].sort((a, b) => a.t - b.t);
  const splits = ordered.map((checkpoint) => ({
    checkpointId: checkpoint.id,
    time: Math.round(Math.max(0, Math.min(1, checkpoint.t)) * target * 1000) / 1000,
  }));
  splits.push({ checkpointId: "finish", time: target });
  return splits;
}

/**
 * The full race-loop definition for a circuit (#APEX-11): the selected stage
 * drives the run's gates, reference pace and opponents, so the race a player
 * starts matches the card they chose. Timing rules are the shared defaults
 * (3-2-1 countdown, +5 s per missed gate, three misses invalidate); the target
 * pace is derived from the sampled centreline length. This is a type-only import
 * of the race contract — no runtime coupling (see the module note above).
 */
export function toStageDefinition(circuit: StageCircuit, lengthM = 500): StageDefinition {
  const target = Math.max(MIN_TARGET_SECONDS, lengthM / AVERAGE_SPEED_MPS);
  const checkpoints = [...circuit.checkpoints]
    .sort((a, b) => a.t - b.t)
    .map((checkpoint, index) => ({ id: checkpoint.id, index, name: checkpoint.name }));
  return {
    id: circuit.id,
    name: circuit.name,
    checkpoints,
    finishId: "finish",
    countdownSeconds: 3,
    penaltySeconds: 5,
    maxPenalties: 3,
    opponents: [
      { name: "Vega", time: Math.round(target * 0.9 * 10) / 10 },
      { name: "Kovač", time: Math.round(target * 1.0 * 10) / 10 },
      { name: "Rustad", time: Math.round(target * 1.1 * 10) / 10 },
    ],
    referenceSplits: referenceTargets(circuit, target),
  };
}
