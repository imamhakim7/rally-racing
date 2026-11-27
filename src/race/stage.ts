import type { StageDefinition } from "./types";

/**
 * Validate a stage definition and return it unchanged (typed as a stage).
 *
 * Fails fast on a malformed stage so a mis-authored course cannot produce a
 * silently broken run (e.g. duplicate gate ids or checkpoint order gaps that
 * would make "next expected checkpoint" advance incorrectly).
 */
export function defineStage(stage: StageDefinition): StageDefinition {
  const { checkpoints, finishId, countdownSeconds, penaltySeconds, maxPenalties, opponents } =
    stage;

  if (!stage.id) throw new Error("stage.id is required");
  if (!finishId) throw new Error("stage.finishId is required");
  if (checkpoints.length === 0) throw new Error("a stage needs at least one checkpoint");

  const seen = new Set<string>();
  checkpoints.forEach((checkpoint, i) => {
    if (!checkpoint.id) throw new Error(`checkpoint[${i}].id is required`);
    if (checkpoint.id === finishId) {
      throw new Error(`checkpoint id "${checkpoint.id}" collides with the finish id`);
    }
    if (seen.has(checkpoint.id)) throw new Error(`duplicate checkpoint id "${checkpoint.id}"`);
    seen.add(checkpoint.id);
    if (checkpoint.index !== i) {
      throw new Error(
        `checkpoint "${checkpoint.id}" has index ${checkpoint.index}; expected ${i} (dense ascending)`,
      );
    }
  });

  if (!(countdownSeconds >= 0)) throw new Error("countdownSeconds must be >= 0");
  if (!(penaltySeconds >= 0)) throw new Error("penaltySeconds must be >= 0");
  if (!(maxPenalties >= 0)) throw new Error("maxPenalties must be >= 0");

  for (const opponent of opponents) {
    if (!opponent.name) throw new Error("opponent.name is required");
    if (!Number.isFinite(opponent.time) || opponent.time < 0) {
      throw new Error(`opponent "${opponent.name}" needs a finite time >= 0`);
    }
  }

  const knownGates = new Set<string>([...seen, finishId]);
  let previousReference = Number.NEGATIVE_INFINITY;
  for (const reference of stage.referenceSplits ?? []) {
    if (!knownGates.has(reference.checkpointId)) {
      throw new Error(`referenceSplits references unknown gate "${reference.checkpointId}"`);
    }
    if (!Number.isFinite(reference.time) || reference.time < 0) {
      throw new Error(`reference split "${reference.checkpointId}" needs a finite time >= 0`);
    }
    if (reference.time < previousReference) {
      throw new Error("referenceSplits times must be non-decreasing (cumulative)");
    }
    previousReference = reference.time;
  }

  return stage;
}

/**
 * The bundled demo stage used by the browser harness and the default entry.
 * Three ordered checkpoints and a finish; 3-2-1 countdown; +5s per missed gate;
 * three misses invalidate the run.
 */
export function createDemoStage(): StageDefinition {
  return defineStage({
    id: "hairpin-hollow",
    name: "Hairpin Hollow",
    checkpoints: [
      { id: "cp-1", index: 0, name: "Hairpin" },
      { id: "cp-2", index: 1, name: "Crest" },
      { id: "cp-3", index: 2, name: "Chicane" },
    ],
    finishId: "finish",
    countdownSeconds: 3,
    penaltySeconds: 5,
    maxPenalties: 3,
    opponents: [
      { name: "Vega", time: 42.5 },
      { name: "Kovač", time: 47.9 },
      { name: "Rustad", time: 55.2 },
    ],
    referenceSplits: [
      { checkpointId: "cp-1", time: 12 },
      { checkpointId: "cp-2", time: 24 },
      { checkpointId: "cp-3", time: 34 },
      { checkpointId: "finish", time: 44 },
    ],
  });
}
