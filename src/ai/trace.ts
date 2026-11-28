/**
 * Replay-trace format and interpolation (#APEX-9).
 *
 * A `RaceTrace` is the serialisable record of a deterministic race: per-step car
 * poses, checkpoint splits and the finish order. It is plain data with **no
 * `node:`/`three.js`/DOM** imports, so both the headless harness (node) and the
 * visible ghost overlay (browser) can consume the same type: record, validate and
 * interpolate a trace here; only the SHA-256 canonicalization lives in the
 * node-only `replay.ts`.
 */
import type { RaceResult } from "./types";

/** Current trace schema. Bumped on any incompatible change. */
export const TRACE_VERSION = 1;

/** One car's pose at a captured step. */
export interface TracePose {
  x: number;
  z: number;
  yaw: number;
  /** Speed magnitude in m/s. */
  speed: number;
  /** Arc-length progress fraction in [0,1]. */
  progress: number;
}

/** One captured simulation step: every car's pose, in stable id order. */
export interface TraceFrame {
  /** Fixed-step index since the start of the race. */
  step: number;
  /** Simulation time in seconds at the start of this step. */
  time: number;
  cars: TracePose[];
}

/** A cumulative timing split when a car first reaches a checkpoint. */
export interface TraceSplit {
  carId: string;
  /** Checkpoint id (or the stage finish id for the final split). */
  checkpointId: string;
  /** Arc-length fraction of the gate. */
  progressT: number;
  /** Cumulative race time in seconds. */
  time: number;
}

/** A complete, serialisable recording of one deterministic race. */
export interface RaceTrace {
  version: typeof TRACE_VERSION;
  generator: "apex-rally";
  stageId: string;
  seed: number;
  /** Fixed simulation step in seconds. */
  dt: number;
  /** One frame is captured every this many fixed steps. */
  sampleEvery: number;
  referenceTime: number;
  window: [number, number];
  /** Car ids in finishing order (finishers first). */
  finishOrder: string[];
  splits: TraceSplit[];
  frames: TraceFrame[];
}

const TAU = Math.PI * 2;

/** Shortest-path angular interpolation from `a` to `b` at `t` in [0,1]. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolated replay frame at `time` (seconds).
 *
 * Returns the first frame for `time` at or before the trace start and the last
 * frame at or after the trace end, so callers can drive a ghost past the finish.
 * Returns `null` for an empty trace.
 */
export function sampleGhost(trace: RaceTrace, time: number): TraceFrame | null {
  const frames = trace.frames;
  if (frames.length === 0) return null;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (time <= first.time) return first;
  if (time >= last.time) return last;

  // Binary search for the frame at or before `time`.
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo]!;
  const b = frames[lo + 1]!;
  const span = b.time - a.time;
  const t = span > 1e-12 ? (time - a.time) / span : 0;

  const cars: TracePose[] = a.cars.map((pa, i) => {
    const pb = b.cars[i]!;
    return {
      x: lerp(pa.x, pb.x, t),
      z: lerp(pa.z, pb.z, t),
      yaw: lerpAngle(pa.yaw, pb.yaw, t),
      speed: lerp(pa.speed, pb.speed, t),
      progress: lerp(pa.progress, pb.progress, t),
    };
  });

  return { step: a.step, time: lerp(a.time, b.time, t), cars };
}

/** Typed error for an unreadable/incompatible trace document. */
export class TraceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceParseError";
  }
}

export interface RecordTraceOptions {
  /** One frame captured every this many fixed steps. */
  sampleEvery: number;
}

/**
 * Assemble a `RaceTrace` from a race result plus the captured frames and splits.
 * Pure and browser-safe: the visible scene can record a reference run in-process.
 */
export function recordTrace(
  result: RaceResult,
  frames: TraceFrame[],
  splits: TraceSplit[],
  options: RecordTraceOptions,
): RaceTrace {
  return {
    version: TRACE_VERSION,
    generator: "apex-rally",
    stageId: result.stageId,
    seed: result.seed,
    dt: result.dt,
    sampleEvery: Math.max(1, Math.floor(options.sampleEvery)),
    referenceTime: result.referenceTime,
    window: [result.window[0], result.window[1]],
    finishOrder: [...result.finishOrder],
    splits: splits.map((s) => ({ ...s })),
    frames: frames.map((f) => ({ step: f.step, time: f.time, cars: f.cars.map((c) => ({ ...c })) })),
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TraceParseError(`trace field '${field}' must be a finite number`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TraceParseError(`trace field '${field}' must be a string`);
  return value;
}

/**
 * Parse and validate a trace document. Throws {@link TraceParseError} on any
 * structural problem (never returns a partially-valid trace). Browser-safe.
 */
export function parseTrace(json: string): RaceTrace {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new TraceParseError(`invalid trace JSON: ${(error as Error).message}`);
  }
  if (!isRecordValue(raw)) throw new TraceParseError("trace must be a JSON object");
  if (raw.version !== TRACE_VERSION) {
    throw new TraceParseError(`unsupported trace version: ${String(raw.version)}`);
  }
  if (raw.generator !== "apex-rally") {
    throw new TraceParseError(`unexpected trace generator: ${String(raw.generator)}`);
  }

  const windowRaw = raw.window;
  if (!Array.isArray(windowRaw) || windowRaw.length !== 2) {
    throw new TraceParseError("trace.window must be a [low, high] pair");
  }
  const window: [number, number] = [
    requireNumber(windowRaw[0], "window[0]"),
    requireNumber(windowRaw[1], "window[1]"),
  ];

  if (!Array.isArray(raw.finishOrder)) throw new TraceParseError("trace.finishOrder must be an array");
  const finishOrder = raw.finishOrder.map((id, i) => requireString(id, `finishOrder[${i}]`));

  if (!Array.isArray(raw.splits)) throw new TraceParseError("trace.splits must be an array");
  const splits: TraceSplit[] = raw.splits.map((entry, i) => {
    if (!isRecordValue(entry)) throw new TraceParseError(`splits[${i}] must be an object`);
    return {
      carId: requireString(entry.carId, `splits[${i}].carId`),
      checkpointId: requireString(entry.checkpointId, `splits[${i}].checkpointId`),
      progressT: requireNumber(entry.progressT, `splits[${i}].progressT`),
      time: requireNumber(entry.time, `splits[${i}].time`),
    };
  });

  if (!Array.isArray(raw.frames)) throw new TraceParseError("trace.frames must be an array");
  const frames: TraceFrame[] = raw.frames.map((entry, i) => {
    if (!isRecordValue(entry)) throw new TraceParseError(`frames[${i}] must be an object`);
    if (!Array.isArray(entry.cars)) throw new TraceParseError(`frames[${i}].cars must be an array`);
    return {
      step: requireNumber(entry.step, `frames[${i}].step`),
      time: requireNumber(entry.time, `frames[${i}].time`),
      cars: entry.cars.map((car, j) => {
        if (!isRecordValue(car)) throw new TraceParseError(`frames[${i}].cars[${j}] must be an object`);
        return {
          x: requireNumber(car.x, `frames[${i}].cars[${j}].x`),
          z: requireNumber(car.z, `frames[${i}].cars[${j}].z`),
          yaw: requireNumber(car.yaw, `frames[${i}].cars[${j}].yaw`),
          speed: requireNumber(car.speed, `frames[${i}].cars[${j}].speed`),
          progress: requireNumber(car.progress, `frames[${i}].cars[${j}].progress`),
        };
      }),
    };
  });

  return {
    version: TRACE_VERSION,
    generator: "apex-rally",
    stageId: requireString(raw.stageId, "stageId"),
    seed: requireNumber(raw.seed, "seed"),
    dt: requireNumber(raw.dt, "dt"),
    sampleEvery: requireNumber(raw.sampleEvery, "sampleEvery"),
    referenceTime: requireNumber(raw.referenceTime, "referenceTime"),
    window,
    finishOrder,
    splits,
    frames,
  };
}

/** Deep structural equality for two traces (used by tests and the CI gate). */
export function tracesEqual(a: RaceTrace, b: RaceTrace): boolean {
  if (a === b) return true;
  if (a.version !== b.version || a.stageId !== b.stageId || a.seed !== b.seed) return false;
  if (a.dt !== b.dt || a.sampleEvery !== b.sampleEvery) return false;
  if (a.finishOrder.length !== b.finishOrder.length) return false;
  for (let i = 0; i < a.finishOrder.length; i += 1) {
    if (a.finishOrder[i] !== b.finishOrder[i]) return false;
  }
  if (a.splits.length !== b.splits.length) return false;
  for (let i = 0; i < a.splits.length; i += 1) {
    const sa = a.splits[i]!;
    const sb = b.splits[i]!;
    if (sa.carId !== sb.carId || sa.checkpointId !== sb.checkpointId) return false;
    if (sa.time !== sb.time || sa.progressT !== sb.progressT) return false;
  }
  if (a.frames.length !== b.frames.length) return false;
  for (let i = 0; i < a.frames.length; i += 1) {
    const fa = a.frames[i]!;
    const fb = b.frames[i]!;
    if (fa.step !== fb.step || fa.time !== fb.time) return false;
    if (fa.cars.length !== fb.cars.length) return false;
    for (let j = 0; j < fa.cars.length; j += 1) {
      const ca = fa.cars[j]!;
      const cb = fb.cars[j]!;
      if (
        ca.x !== cb.x ||
        ca.z !== cb.z ||
        ca.yaw !== cb.yaw ||
        ca.speed !== cb.speed ||
        ca.progress !== cb.progress
      ) {
        return false;
      }
    }
  }
  return true;
}
