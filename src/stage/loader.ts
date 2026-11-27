/**
 * Stage loading entry points.
 *
 * `loadStage` validates an already-parsed document; `parseStage` adds JSON
 * parsing and turns a syntax error into the same `StageValidationError` shape so
 * callers only ever catch one error type. Neither touches the world — a stage
 * that fails validation never reaches `buildStageWorld`.
 */
import { StageValidationError } from "./errors";
import { validateStage } from "./validate";
import type { StageCircuit } from "./types";

/** Validate an already-parsed stage document into a normalised circuit. */
export function loadStage(value: unknown, source = "<stage>"): StageCircuit {
  return validateStage(value, source);
}

/** Parse JSON text and validate it. A syntax error names the source and offset. */
export function parseStage(text: string, source = "<stage>"): StageCircuit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StageValidationError(
      [
        {
          path: "$",
          code: "parse",
          value: text.slice(0, 48),
          message: `not valid JSON: ${(error as Error).message}`,
        },
      ],
      source,
    );
  }
  return validateStage(parsed, source);
}
