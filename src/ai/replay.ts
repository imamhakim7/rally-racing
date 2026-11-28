/**
 * Canonical replay serialization + content hashing (#APEX-9). Node-only.
 *
 * The determinism contract needs a byte-stable encoding of a race: two runs of
 * the same `(circuit, cars, seed)` must produce the **same JSON string** and the
 * **same `traceHash`**. To make that true across processes and platforms we
 * always emit keys in a fixed order and rely on ECMAScript's shortest
 * round-trip number serialization. `node:crypto` is used only because it is a
 * standard, dependency-free, deterministic SHA-256 — this is an integrity hash,
 * not a secret. Recording and parsing a trace are browser-safe and live in
 * `trace.ts`.
 */
import { createHash } from "node:crypto";
import type { RaceTrace } from "./trace";

/**
 * Rebuild a trace with a fixed key order and plain arrays. `JSON.stringify`
 * preserves insertion order, so this object's serialization is canonical.
 */
function canonical(trace: RaceTrace): unknown {
  return {
    version: trace.version,
    generator: trace.generator,
    stageId: trace.stageId,
    seed: trace.seed,
    dt: trace.dt,
    sampleEvery: trace.sampleEvery,
    referenceTime: trace.referenceTime,
    window: [trace.window[0], trace.window[1]],
    finishOrder: [...trace.finishOrder],
    splits: trace.splits.map((s) => ({
      carId: s.carId,
      checkpointId: s.checkpointId,
      progressT: s.progressT,
      time: s.time,
    })),
    frames: trace.frames.map((f) => ({
      step: f.step,
      time: f.time,
      cars: f.cars.map((c) => ({
        x: c.x,
        z: c.z,
        yaw: c.yaw,
        speed: c.speed,
        progress: c.progress,
      })),
    })),
  };
}

/** Canonical, human-readable JSON (used for the committed evidence artifacts). */
export function serializeTrace(trace: RaceTrace): string {
  return JSON.stringify(canonical(trace), null, 2);
}

/** Compact canonical JSON — the exact bytes whose SHA-256 is the `traceHash`. */
export function canonicalTraceJson(trace: RaceTrace): string {
  return JSON.stringify(canonical(trace));
}

/** Stable content hash (SHA-256 hex) of a trace. Equal runs ⇒ equal hash. */
export function traceHash(trace: RaceTrace): string {
  return createHash("sha256").update(canonicalTraceJson(trace)).digest("hex");
}

/** Hash of an already-serialised trace document. */
export function hashTraceJson(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}
