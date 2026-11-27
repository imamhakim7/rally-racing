import { describe, expect, it } from "vitest";
import { StageLibrary, collectBundledStages } from "../src/stage/library";
import { parseStage } from "../src/stage/loader";
import { buildStageWorld, disposeStageWorld } from "../src/stage/world";
import { toRaceStage } from "../src/stage/race-adapter";
import { validateStage } from "../src/stage/validate";
import { clone, makeStageDocument } from "./stage-fixtures";

describe("stage library", () => {
  it("discovers at least six bundled stages across distinct biomes (AC6)", () => {
    const library = new StageLibrary();
    expect(library.size).toBeGreaterThanOrEqual(6);

    const catalog = library.list();
    expect(catalog.length).toBeGreaterThanOrEqual(6);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
    expect(new Set(catalog.map((entry) => entry.biome)).size).toBeGreaterThanOrEqual(6);
    // `collectBundledStages` is the "no code change" discovery path.
    expect(collectBundledStages().length).toBeGreaterThanOrEqual(6);
  });

  it("loads and builds every shipped stage without error (AC1/AC6)", () => {
    const library = new StageLibrary();
    for (const entry of library.list()) {
      const circuit = library.load(entry.id);
      expect(circuit.id).toBe(entry.id);
      const world = buildStageWorld(circuit);
      expect(world.gates.length).toBeGreaterThanOrEqual(2);
      disposeStageWorld(world);
    }
  });

  it("fails loudly for an unknown stage id", () => {
    const library = new StageLibrary();
    expect(library.has("nope")).toBe(false);
    expect(() => library.load("nope")).toThrow(/unknown stage: nope/);
  });

  it("rejects a duplicate stage id", () => {
    const stage = clone(makeStageDocument());
    expect(
      () =>
        new StageLibrary([
          { source: "a.json", data: stage },
          { source: "b.json", data: clone(stage) },
        ]),
    ).toThrow(/duplicate stage id/);
  });
});

describe("loader + race adapter", () => {
  it("parses a JSON string into a circuit (AC1)", () => {
    const circuit = parseStage(JSON.stringify(makeStageDocument()), "inline.json");
    expect(circuit.id).toBe("test-stage");
    expect(circuit.source).toBe("inline.json");
  });

  it("projects a circuit into the race-loop gate shape", () => {
    const circuit = validateStage(clone(makeStageDocument()), "race.json");
    const race = toRaceStage(circuit);
    expect(race.finishId).toBe("finish");
    expect(race.gateCount).toBe(circuit.checkpoints.length + 1);
    expect(race.checkpoints).toEqual([
      { id: "cp-1", index: 0, name: "One" },
      { id: "cp-2", index: 1, name: "Two" },
    ]);
  });
});
