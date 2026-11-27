import { describe, expect, it } from "vitest";
import { StageValidationError } from "../src/stage/errors";
import { parseStage } from "../src/stage/loader";
import { validateStage } from "../src/stage/validate";
import { clone, makeStageDocument } from "./stage-fixtures";

function expectError(doc: unknown, source = "test.json"): StageValidationError {
  try {
    validateStage(doc, source);
  } catch (error) {
    expect(error).toBeInstanceOf(StageValidationError);
    return error as StageValidationError;
  }
  throw new Error("expected validateStage to throw");
}

describe("stage validation", () => {
  it("accepts a valid stage and applies documented defaults (AC1)", () => {
    const doc = clone(makeStageDocument());
    delete (doc as Record<string, unknown>).difficulty;
    delete ((doc as Record<string, unknown>).road as Record<string, unknown>).sampleStep;
    delete (doc as Record<string, unknown>).minimap;

    const circuit = validateStage(doc, "defaults.json");

    expect(circuit.id).toBe("test-stage");
    expect(circuit.difficulty).toBe(3);
    expect(circuit.road.sampleStep).toBe(2);
    expect(circuit.minimap.path).toBe("auto");
    expect(circuit.source).toBe("defaults.json");
    // Surfaces are returned ordered by `from`.
    expect(circuit.surfaces.map((s) => s.id)).toEqual(["sz-a", "sz-b", "sz-c"]);
  });

  it("names a missing required field (AC7)", () => {
    const doc = clone(makeStageDocument());
    delete (doc as Record<string, unknown>).name;
    const error = expectError(doc);
    expect(error.has("name")).toBe(true);
    expect(error.issues.find((i) => i.path === "name")?.code).toBe("required");
  });

  it("names a wrong-typed field with its exact path (AC7)", () => {
    const doc = clone(makeStageDocument());
    (doc.checkpoints as Array<Record<string, unknown>>)[1]!.width = "wide";
    const error = expectError(doc);
    expect(error.path).toBe("checkpoints[1].width");
    expect(error.issues.find((i) => i.path === "checkpoints[1].width")?.code).toBe("type");
    expect(error.message).toContain("checkpoints[1].width");
  });

  it("names an out-of-range value (AC7)", () => {
    const doc = clone(makeStageDocument());
    (doc.checkpoints as Array<Record<string, unknown>>)[0]!.t = 1.5;
    const error = expectError(doc);
    expect(error.has("checkpoints[0].t")).toBe(true);
    expect(error.issues.find((i) => i.path === "checkpoints[0].t")?.code).toBe("range");
  });

  it("rejects an unknown enum member (AC7)", () => {
    const doc = clone(makeStageDocument());
    doc.biome = "lunar";
    expect(expectError(doc).has("biome")).toBe(true);
  });

  it("rejects a duplicate checkpoint id (AC7)", () => {
    const doc = clone(makeStageDocument());
    (doc.checkpoints as Array<Record<string, unknown>>)[1]!.id = "cp-1";
    const error = expectError(doc);
    expect(error.issues.find((i) => i.path === "checkpoints[1].id")?.code).toBe("unique");
  });

  it("rejects mis-ordered checkpoints (AC7)", () => {
    const doc = clone(makeStageDocument());
    (doc.checkpoints as Array<Record<string, unknown>>)[1]!.t = 0.1;
    expect(expectError(doc).issues.find((i) => i.path === "checkpoints[1].t")?.code).toBe("ordering");
  });

  it("rejects a surface gap with a coverage error naming the zone (AC7)", () => {
    const doc = clone(makeStageDocument());
    (doc.surfaces as Array<Record<string, unknown>>)[1]!.from = 0.35;
    const error = expectError(doc);
    const coverage = error.issues.find((i) => i.code === "coverage");
    expect(coverage).toBeDefined();
    expect(coverage!.message).toContain("sz-b");
  });

  it("rejects an unsupported schema version (AC7)", () => {
    const doc = clone(makeStageDocument());
    doc.schemaVersion = 2;
    expect(expectError(doc).issues.find((i) => i.path === "schemaVersion")?.code).toBe("version");
  });

  it("reports every problem in one error, not just the first (AC7)", () => {
    const doc = clone(makeStageDocument());
    doc.name = "";
    doc.biome = "lunar";
    (doc.checkpoints as Array<Record<string, unknown>>)[0]!.width = -1;
    const error = expectError(doc);
    const paths = error.issues.map((i) => i.path);
    expect(paths).toContain("name");
    expect(paths).toContain("biome");
    expect(paths).toContain("checkpoints[0].width");
  });

  it("turns malformed JSON into a parse error naming the source (AC7)", () => {
    try {
      parseStage("{ not json", "broken.json");
      throw new Error("expected parseStage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StageValidationError);
      expect((error as StageValidationError).path).toBe("$");
      expect((error as StageValidationError).issues[0]!.code).toBe("parse");
      expect((error as Error).message).toContain("broken.json");
    }
  });
});
