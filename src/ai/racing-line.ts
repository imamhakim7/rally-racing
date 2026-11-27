/**
 * Racing-line derivation.
 *
 * The centreline is a safe line but not a *fast* one: it runs the long way round
 * a corner. This module turns the arc-length centreline into a racing line —
 * a corner-cutting lateral offset plus a **feasible** target-speed profile — so
 * a driver slows before a tight corner and accelerates out of it.
 *
 * Everything is pure and deterministic: same circuit ⇒ same line.
 */
import type { SampledSpline } from "../stage/spline";
import type { StageCircuit, Vec3 } from "../stage/types";
import { wrapAngle } from "../physics/util";
import { physicsSurfaceAt } from "./surface";
import type { RacingLine, RacingLineOptions, RacingLinePoint } from "./types";

const GRAVITY = 9.81;

const DEFAULTS = {
  maxOffsetFraction: 0.6,
  cornerCut: 12,
  lateralEfficiency: 0.78,
  vMax: 40,
  brakeDecel: 8,
  accel: 4.5,
  offsetSmoothing: 5,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function lerpVec(a: Vec3, b: Vec3, u: number): Vec3 {
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) };
}

/** Box-blur a signal in place over `window` samples (window must be odd ≥ 1). */
function smooth(values: number[], window: number): void {
  const n = values.length;
  if (window <= 1 || n < 3) return;
  const half = Math.floor(window / 2);
  const source = values.slice();
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      const k = clamp(j, 0, n - 1);
      sum += source[k]!;
      count += 1;
    }
    values[i] = sum / count;
  }
}

/**
 * Build the racing line for a stage.
 *
 * @param circuit validated stage (road width, surfaces)
 * @param spline  the arc-length sampled centreline (#APEX-4)
 */
export function buildRacingLine(
  circuit: StageCircuit,
  spline: SampledSpline,
  options: RacingLineOptions = {},
): RacingLine {
  const opts = { ...DEFAULTS, ...options };
  const count = spline.count;
  const halfWidth = circuit.road.width / 2;
  const maxOffset = opts.maxOffsetFraction * halfWidth;

  // Not enough samples to derive a line: return the degenerate single point.
  if (count < 2 || spline.length <= 1e-6) {
    const position = spline.positionAt(0);
    const tangent = spline.tangentAt(0);
    const normal = spline.normalAt(0);
    const point: RacingLinePoint = {
      index: 0,
      position,
      tangent,
      normal,
      curvature: 0,
      targetSpeed: opts.vMax,
      offset: 0,
      distance: 0,
    };
    return {
      points: [point],
      length: 0,
      referenceTime: 0,
      sampleAtDistance: () => point,
      indexAtDistance: () => 0,
    };
  }

  const curvature = new Array<number>(count).fill(0);
  const offsets = new Array<number>(count).fill(0);
  const grip = new Array<number>(count).fill(1);

  for (let i = 0; i < count; i += 1) {
    const t = spline.ts[i]!;
    grip[i] = physicsSurfaceAt(circuit, t).grip;
    const prev = Math.max(i - 1, 0);
    const next = Math.min(i + 1, count - 1);
    const ds = Math.max(spline.distances[next]! - spline.distances[prev]!, 1e-6);
    const yawPrev = Math.atan2(spline.tangentAt(prev).x, spline.tangentAt(prev).z);
    const yawNext = Math.atan2(spline.tangentAt(next).x, spline.tangentAt(next).z);
    curvature[i] = wrapAngle(yawNext - yawPrev) / ds;
  }

  for (let i = 0; i < count; i += 1) {
    const k = curvature[i]!;
    offsets[i] = clamp(-Math.sign(k) * opts.cornerCut * Math.abs(k), -maxOffset, maxOffset);
  }
  smooth(offsets, opts.offsetSmoothing);

  // Target speed: lateral limit per sample, then a feasible brake/accel profile.
  const speed = new Array<number>(count).fill(opts.vMax);
  for (let i = 0; i < count; i += 1) {
    const k = Math.max(Math.abs(curvature[i]!), 1e-4);
    const lateralCap = Math.sqrt((grip[i]! * GRAVITY * opts.lateralEfficiency) / k);
    speed[i] = Math.min(opts.vMax, lateralCap);
  }
  for (let i = count - 2; i >= 0; i -= 1) {
    const ds = Math.max(spline.distances[i + 1]! - spline.distances[i]!, 0);
    const maxEnter = Math.sqrt(speed[i + 1]! * speed[i + 1]! + 2 * opts.brakeDecel * ds);
    speed[i] = Math.min(speed[i]!, maxEnter);
  }
  for (let i = 1; i < count; i += 1) {
    const ds = Math.max(spline.distances[i]! - spline.distances[i - 1]!, 0);
    const maxExit = Math.sqrt(speed[i - 1]! * speed[i - 1]! + 2 * opts.accel * ds);
    speed[i] = Math.min(speed[i]!, maxExit);
  }

  const points: RacingLinePoint[] = new Array(count);
  let referenceTime = 0;
  for (let i = 0; i < count; i += 1) {
    const centre = spline.positionAt(i);
    const tangent = spline.tangentAt(i);
    const normal = spline.normalAt(i);
    points[i] = {
      index: i,
      position: addScaled(centre, normal, offsets[i]!),
      tangent,
      normal,
      curvature: curvature[i]!,
      targetSpeed: speed[i]!,
      offset: offsets[i]!,
      distance: spline.distances[i]!,
    };
    if (i > 0) {
      const ds = spline.distances[i]! - spline.distances[i - 1]!;
      const vMean = (speed[i]! + speed[i - 1]!) / 2;
      referenceTime += vMean > 1e-6 ? ds / vMean : 0;
    }
  }

  const length = spline.length;
  const lastIndex = count - 1;

  function fractionAt(distance: number): number {
    return clamp(distance / length, 0, 1);
  }

  const api: RacingLine = {
    points,
    length,
    referenceTime,
    indexAtDistance(distance) {
      return Math.round(fractionAt(distance) * lastIndex);
    },
    sampleAtDistance(distance) {
      const floatIndex = fractionAt(distance) * lastIndex;
      const lo = Math.floor(floatIndex);
      const hi = Math.min(lo + 1, lastIndex);
      const u = floatIndex - lo;
      const a = points[lo]!;
      const b = points[hi]!;
      if (u <= 0 || lo === hi) return a;
      return {
        index: lo,
        position: lerpVec(a.position, b.position, u),
        tangent: lerpVec(a.tangent, b.tangent, u),
        normal: lerpVec(a.normal, b.normal, u),
        curvature: lerp(a.curvature, b.curvature, u),
        targetSpeed: lerp(a.targetSpeed, b.targetSpeed, u),
        offset: lerp(a.offset, b.offset, u),
        distance: lerp(a.distance, b.distance, u),
      };
    },
  };
  return api;
}
