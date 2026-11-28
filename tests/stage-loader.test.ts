import { describe, expect, it } from "vitest";
import { StageLibrary, collectBundledStages } from "../src/stage/library";
import { parseStage } from "../src/stage/loader";
import { buildStageWorld, disposeStageWorld } from "../src/stage/world";
import { toRaceStage, toStageDefinition } from "../src/stage/race-adapter";
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

  it("reports a sampled centreline length for every catalog entry (#APEX-11 AC2)", () => {
    const library = new StageLibrary();
    for (const entry of library.list()) {
      expect(Number.isFinite(entry.lengthM)).toBe(true);
      expect(entry.lengthM).toBeGreaterThan(0);
    }
  });

  it("builds a race definition whose gates and pace follow the circuit (#APEX-11 AC4)", () => {
    const library = new StageLibrary();
    for (const entry of library.list()) {
      const circuit = library.load(entry.id);
      const stage = toStageDefinition(circuit, entry.lengthM);
      expect(stage.id).toBe(entry.id);
      expect(stage.checkpoints.map((cp) => cp.id)).toEqual(
        [...circuit.checkpoints].sort((a, b) => a.t - b.t).map((cp) => cp.id),
      );
      expect(stage.checkpoints.map((cp) => cp.index)).toEqual(
        stage.checkpoints.map((_, i) => i),
      );
      // Reference splits are cumulative + non-decreasing, ending at the finish.
      const splits = stage.referenceSplits ?? [];
      expect(splits.at(-1)?.checkpointId).toBe("finish");
      for (let i = 1; i < splits.length; i += 1) {
        expect(splits[i]!.time).toBeGreaterThanOrEqual(splits[i - 1]!.time);
      }
      expect(stage.opponents.length).toBeGreaterThan(0);
    }
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
