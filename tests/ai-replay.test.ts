import { describe, expect, it } from "vitest";
import { StageLibrary } from "../src/stage/library";
import { simulateRace } from "../src/ai/race";
import { runHeadlessRace, FINISH_SPLIT_ID } from "../src/ai/harness";
import { canonicalTraceJson, serializeTrace, traceHash } from "../src/ai/replay";
import { parseTrace, sampleGhost, tracesEqual, TraceParseError } from "../src/ai/trace";
import { GhostOverlay } from "../src/ai/ghost";

const library = new StageLibrary();
const stages = library.list();

describe("headless harness — determinism across runs", () => {
  it("produces an identical trace and hash for the same seed", () => {
    const circuit = library.load(stages[0]!.id);
    const a = runHeadlessRace(circuit, { seed: 123 });
    const b = runHeadlessRace(circuit, { seed: 123 });

    expect(a.hash).toBe(b.hash);
    expect(canonicalTraceJson(a.trace)).toBe(canonicalTraceJson(b.trace));
    expect(tracesEqual(a.trace, b.trace)).toBe(true);
    expect(a.trace.finishOrder).toEqual(b.trace.finishOrder);
    expect(a.result.cars.map((c) => c.finishTime)).toEqual(b.result.cars.map((c) => c.finishTime));
  });

  it("holds determinism on every shipped stage", () => {
    for (const stage of stages) {
      const circuit = library.load(stage.id);
      const a = runHeadlessRace(circuit, { seed: 7 });
      const b = runHeadlessRace(circuit, { seed: 7 });
      expect(a.hash, `${stage.id} hash`).toBe(b.hash);
      // Hash is a non-empty sha-256 hex.
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("varies the trace when the seed changes", () => {
    const circuit = library.load(stages[0]!.id);
    const a = runHeadlessRace(circuit, { seed: 1 });
    const b = runHeadlessRace(circuit, { seed: 2 });
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("recording is inert (observation only)", () => {
  it("does not change the RaceResult when onStep is supplied", () => {
    const circuit = library.load(stages[1]!.id);
    const plain = simulateRace(circuit, { seed: 42 });
    const frames: unknown[] = [];
    const observed = simulateRace(circuit, { seed: 42, onStep: (f) => frames.push(f) });

    expect(frames.length).toBeGreaterThan(0);
    expect(observed.cars.map((c) => c.finishTime)).toEqual(plain.cars.map((c) => c.finishTime));
    expect(observed.cars.map((c) => c.progress)).toEqual(plain.cars.map((c) => c.progress));
    expect(observed.finishOrder).toEqual(plain.finishOrder);
    expect(observed.minSeparation).toBe(plain.minSeparation);
  });
});

describe("trace serialization round-trip", () => {
  it("parses back to an equal trace with an equal hash", () => {
    const circuit = library.load(stages[2]!.id);
    const { trace, hash } = runHeadlessRace(circuit, { seed: 99 });
    const parsed = parseTrace(serializeTrace(trace));
    expect(tracesEqual(parsed, trace)).toBe(true);
    expect(traceHash(parsed)).toBe(hash);
    expect(canonicalTraceJson(parsed)).toBe(canonicalTraceJson(trace));
  });

  it("rejects malformed or unsupported documents", () => {
    expect(() => parseTrace("{}")).toThrow(TraceParseError);
    expect(() => parseTrace("not json")).toThrow(TraceParseError);
    const circuit = library.load(stages[0]!.id);
    const { trace } = runHeadlessRace(circuit, { seed: 1 });
    const doc = JSON.parse(serializeTrace(trace)) as Record<string, unknown>;
    doc.version = 999;
    expect(() => parseTrace(JSON.stringify(doc))).toThrow(/unsupported trace version/);
  });

  it("captures one frame per sample interval with a pose per car", () => {
    const circuit = library.load(stages[0]!.id);
    const { result, trace } = runHeadlessRace(circuit, { seed: 3, traceEvery: 10 });
    expect(trace.frames.length).toBeGreaterThan(0);
    for (const frame of trace.frames) {
      expect(frame.step % 10).toBe(0);
      expect(frame.cars).toHaveLength(result.cars.length);
    }
    // Frame steps are strictly increasing.
    for (let i = 1; i < trace.frames.length; i += 1) {
      expect(trace.frames[i]!.step).toBeGreaterThan(trace.frames[i - 1]!.step);
    }
  });
});

describe("checkpoint splits", () => {
  it("records monotonically increasing times in gate order", () => {
    const circuit = library.load(stages[0]!.id);
    const { result, splitTable } = runHeadlessRace(circuit, { seed: 5 });
    for (const car of result.cars) {
      const splits = splitTable[car.id]!;
      // At least a finish split.
      expect(splits.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < splits.length; i += 1) {
        expect(splits[i]!.time).toBeGreaterThanOrEqual(splits[i - 1]!.time);
        expect(splits[i]!.progressT).toBeGreaterThanOrEqual(splits[i - 1]!.progressT);
      }
      expect(splits[splits.length - 1]!.checkpointId).toBe(FINISH_SPLIT_ID);
      expect(splits[splits.length - 1]!.time).toBe(car.finishTime);
    }
  });
});

describe("ghost replay", () => {
  it("samples the recorded run at recorded and interpolated times", () => {
    const circuit = library.load(stages[0]!.id);
    const { result, trace } = runHeadlessRace(circuit, { seed: 11, traceEvery: 6 });
    const ghost = new GhostOverlay(trace);

    expect(ghost.carCount).toBe(result.cars.length);
    expect(ghost.finishOrder).toEqual(result.finishOrder);
    expect(ghost.duration).toBeGreaterThan(0);

    const first = trace.frames[0]!;
    const last = trace.frames[trace.frames.length - 1]!;
    expect(ghost.poseAt(-5)).toEqual(first);
    expect(ghost.poseAt(ghost.duration + 5)).toEqual(last);

    const midTime = (first.time + last.time) / 2;
    const mid = ghost.poseAt(midTime);
    expect(mid).not.toBeNull();
    expect(mid!.cars).toHaveLength(result.cars.length);
    // Interpolation stays within the recorded envelope of the two neighbours.
    expect(mid!.time).toBeGreaterThanOrEqual(first.time);
    expect(mid!.time).toBeLessThanOrEqual(last.time);
  });

  it("returns null for an empty trace and the sole frame for a single frame", () => {
    const circuit = library.load(stages[0]!.id);
    const { trace } = runHeadlessRace(circuit, { seed: 1 });
    const empty = { ...trace, frames: [] };
    expect(sampleGhost(empty, 1)).toBeNull();
    const single = { ...trace, frames: [trace.frames[0]!] };
    expect(sampleGhost(single, 999)).toEqual(trace.frames[0]);
  });
});
