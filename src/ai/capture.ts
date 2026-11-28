/**
 * Race capture core (#APEX-9). Browser-safe (no `node:` imports).
 *
 * {@link captureRace} drives #APEX-7's `simulateRace` with an observation
 * recorder, derives per-car checkpoint splits from arc-progress crossings, and
 * returns the race result, a serialisable {@link RaceTrace} and a per-car split
 * table. It is a pure function of `(circuit, cars, seed, dt, traceEvery)`.
 *
 * The node-only wrapper `runHeadlessRace` adds the SHA-256 `hash`; the visible
 * scene uses this directly to record an in-process reference run as a ghost.
 */
import { simulateRace } from "./race";
import type { RaceResult, RaceOptions } from "./types";
import { recordTrace, type RaceTrace, type TraceFrame, type TraceSplit } from "./trace";
import type { StageCircuit } from "../stage/types";

/** One recorded split for a car. */
export interface HarnessSplit {
  checkpointId: string;
  /** Cumulative race time in seconds at the gate. */
  time: number;
  /** Arc-length fraction of the gate. */
  progressT: number;
}

export interface CaptureRaceOptions extends RaceOptions {
  /**
   * Store one trace frame every this many fixed steps (splits are always
   * detected at full step resolution). Default 6 (~10 Hz at 60 Hz).
   */
  traceEvery?: number;
  /** Gate list to split on. Defaults to `circuit.checkpoints`. */
  checkpoints?: readonly { id: string; t: number }[];
}

export interface CapturedRace {
  result: RaceResult;
  trace: RaceTrace;
  /** Per-car cumulative splits, in gate order (the finish last). */
  splitTable: Record<string, HarnessSplit[]>;
}

const DEFAULT_TRACE_EVERY = 6;
/** Gate id used for the finish split (the circuit has no explicit finish id). */
export const FINISH_SPLIT_ID = "finish";

/**
 * Run one deterministic race and capture its replay trace.
 *
 * @param circuit validated stage circuit (#APEX-4)
 * @param options cars, seed, step, trace cadence and optional gate override
 */
export function captureRace(circuit: StageCircuit, options: CaptureRaceOptions = {}): CapturedRace {
  const { traceEvery: traceEveryRaw, checkpoints: checkpointOverride, ...raceOptions } = options;
  const traceEvery =
    traceEveryRaw && traceEveryRaw > 0 ? Math.floor(traceEveryRaw) : DEFAULT_TRACE_EVERY;

  // Gate list in ascending arc-progress order. The finish is implicit and uses
  // the result's exact finish time (a fraction of the racing line differs from
  // the centreline, so progress-crossing is a good proxy for checkpoints but the
  // finish must agree with `CarResult.finishTime`).
  const checkpoints = (
    checkpointOverride ?? circuit.checkpoints.map((c) => ({ id: c.id, t: c.t }))
  )
    .slice()
    .sort((a, b) => a.t - b.t);

  const frames: TraceFrame[] = [];
  const pending: { carIndex: number; checkpointId: string; progressT: number; time: number }[] = [];
  const cursor: number[] = [];

  const result = simulateRace(circuit, {
    ...raceOptions,
    sampleEvery: 1,
    onStep: (frame) => {
      for (let i = 0; i < frame.cars.length; i += 1) {
        if (cursor[i] === undefined) cursor[i] = 0;
        const car = frame.cars[i]!;
        while (cursor[i]! < checkpoints.length && car.progress >= checkpoints[cursor[i]!]!.t) {
          const gate = checkpoints[cursor[i]!]!;
          pending.push({
            carIndex: i,
            checkpointId: gate.id,
            progressT: gate.t,
            time: frame.time,
          });
          cursor[i] = cursor[i]! + 1;
        }
      }
      if (frame.step % traceEvery === 0) {
        frames.push({ step: frame.step, time: frame.time, cars: frame.cars.map((c) => ({ ...c })) });
      }
    },
  });

  const splits: TraceSplit[] = [];
  const splitTable: Record<string, HarnessSplit[]> = {};
  for (const car of result.cars) splitTable[car.id] = [];
  for (const entry of pending) {
    const car = result.cars[entry.carIndex];
    if (!car) continue;
    const split: TraceSplit = {
      carId: car.id,
      checkpointId: entry.checkpointId,
      progressT: entry.progressT,
      time: entry.time,
    };
    splits.push(split);
    splitTable[car.id]!.push({
      checkpointId: split.checkpointId,
      time: split.time,
      progressT: split.progressT,
    });
  }
  for (const car of result.cars) {
    if (car.finishTime === null) continue;
    const split: TraceSplit = {
      carId: car.id,
      checkpointId: FINISH_SPLIT_ID,
      progressT: 1,
      time: car.finishTime,
    };
    splits.push(split);
    splitTable[car.id]!.push({
      checkpointId: split.checkpointId,
      time: split.time,
      progressT: split.progressT,
    });
  }

  const trace = recordTrace(result, frames, splits, { sampleEvery: traceEvery });
  return { result, trace, splitTable };
}
