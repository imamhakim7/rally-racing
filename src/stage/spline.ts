/**
 * Centreline maths.
 *
 * A stage's centreline is a Catmull-Rom spline through the file's control
 * points. Everything downstream (road mesh, gate transforms, minimap, pace
 * notes) reads the **arc-length** parameterisation produced here, so a `t` of
 * 0.25 is a quarter of the *distance* along the stage, not a quarter of the
 * control-point parameter range. The sampler is pure and deterministic: the
 * same circuit always yields the same samples, which keeps tests headless and
 * the world reproducible.
 */
import type { SplineDef, Vec2, Vec3 } from "./types";

export interface SampledSpline {
  readonly closed: boolean;
  /** Total arc length in metres. */
  readonly length: number;
  /** Number of cross-sections. */
  readonly count: number;
  readonly positions: Float32Array;
  readonly tangents: Float32Array;
  readonly normals: Float32Array;
  /** Arc-length fraction in [0,1) (closed) or [0,1] (open) per sample. */
  readonly ts: Float32Array;
  /** Distance in metres from the start per sample. */
  readonly distances: Float32Array;

  positionAt(index: number): Vec3;
  tangentAt(index: number): Vec3;
  normalAt(index: number): Vec3;
  /** Nearest sample index for an arc-length fraction `t`. */
  indexAtT(t: number): number;
  /** Interpolated frame at an arc-length fraction `t`. */
  sampleAtT(t: number): { position: Vec3; tangent: Vec3; normal: Vec3; index: number };
  /** Cumulative distance at an arc-length fraction `t`. */
  distanceAtT(t: number): number;
}

export interface Corner {
  index: number;
  t: number;
  /** Signed heading change in degrees; negative = left, positive = right. */
  angleDeg: number;
  direction: "left" | "right";
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 0, z: 1 };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Hermite blend between `p1` and `p2` with Catmull-Rom tangents scaled by `tension`. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number, tension: number): Vec3 {
  const m1 = scale(sub(p2, p0), tension);
  const m2 = scale(sub(p3, p1), tension);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return add(
    add(scale(p1, h00), scale(m1, h10)),
    add(scale(p2, h01), scale(m2, h11)),
  );
}

/** The four control points used for segment `i` (open endpoints are duplicated). */
function segmentControls(points: Vec3[], closed: boolean, i: number): [Vec3, Vec3, Vec3, Vec3] {
  const n = points.length;
  const at = (idx: number): Vec3 => {
    if (closed) return points[((idx % n) + n) % n]!;
    return points[Math.min(Math.max(idx, 0), n - 1)]!;
  };
  return [at(i - 1), at(i), at(i + 1), at(i + 2)];
}

/**
 * Sample a centreline into evenly-spaced cross-sections.
 *
 * @param spline   the file's spline definition
 * @param sampleStep desired distance between cross-sections, in metres
 */
export function sampleSpline(spline: SplineDef, sampleStep: number): SampledSpline {
  const points: Vec3[] = spline.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const closed = spline.closed;
  const tension = spline.tension;
  const n = points.length;
  const segmentCount = closed ? n : n - 1;

  // Dense raw polyline (never coarser than ~0.5 m) so arc length is accurate.
  const raw: Vec3[] = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const [p0, p1, p2, p3] = segmentControls(points, closed, i);
    const chord = distance(p1, p2);
    const sub = Math.max(4, Math.ceil(chord / 0.5));
    for (let s = 0; s < sub; s += 1) {
      raw.push(catmullRom(p0, p1, p2, p3, s / sub, tension));
    }
  }
  raw.push(closed ? points[0]! : points[n - 1]!);

  // Cumulative arc length along the raw polyline.
  const cumulative = new Float64Array(raw.length);
  for (let i = 1; i < raw.length; i += 1) {
    cumulative[i] = cumulative[i - 1]! + distance(raw[i - 1]!, raw[i]!);
  }
  const total = cumulative[raw.length - 1]!;

  const step = sampleStep > 0 ? sampleStep : 1;
  const count = Math.max(2, Math.round(total / step) + 1);
  const positions = new Float32Array(count * 3);
  const tangents = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const ts = new Float32Array(count);
  const distances = new Float32Array(count);

  let cursor = 0;
  for (let k = 0; k < count; k += 1) {
    const target = total * (k / (count - 1));
    while (cursor < raw.length - 2 && cumulative[cursor + 1]! < target) cursor += 1;
    const segStart = cumulative[cursor]!;
    const segEnd = cumulative[cursor + 1]!;
    const span = segEnd - segStart;
    const u = span > 1e-9 ? (target - segStart) / span : 0;
    const a = raw[cursor]!;
    const b = raw[Math.min(cursor + 1, raw.length - 1)]!;
    const point: Vec3 = {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
    };
    positions[k * 3] = point.x;
    positions[k * 3 + 1] = point.y;
    positions[k * 3 + 2] = point.z;
    distances[k] = target;
    ts[k] = k / (count - 1);
  }

  // Central-difference tangents + horizontal normals.
  const positionRead = (i: number): Vec3 => ({
    x: positions[Math.min(Math.max(i, 0), count - 1) * 3]!,
    y: positions[Math.min(Math.max(i, 0), count - 1) * 3 + 1]!,
    z: positions[Math.min(Math.max(i, 0), count - 1) * 3 + 2]!,
  });
  for (let k = 0; k < count; k += 1) {
    const prev = positionRead(k - 1);
    const next = positionRead(k + 1);
    const tangent = normalize(sub(next, prev));
    tangents[k * 3] = tangent.x;
    tangents[k * 3 + 1] = tangent.y;
    tangents[k * 3 + 2] = tangent.z;
    let right = normalize(cross(UP, tangent));
    if (!Number.isFinite(right.x) || length(right) < 1e-6) right = { x: 1, y: 0, z: 0 };
    normals[k * 3] = right.x;
    normals[k * 3 + 1] = right.y;
    normals[k * 3 + 2] = right.z;
  }

  const api: SampledSpline = {
    closed,
    length: total,
    count,
    positions,
    tangents,
    normals,
    ts,
    distances,
    positionAt(index) {
      return readVec(positions, clampIndex(index, count));
    },
    tangentAt(index) {
      return readVec(tangents, clampIndex(index, count));
    },
    normalAt(index) {
      return readVec(normals, clampIndex(index, count));
    },
    indexAtT(t) {
      return Math.round(clamp01(t) * (count - 1));
    },
    distanceAtT(t) {
      return total * clamp01(t);
    },
    sampleAtT(t) {
      const clamped = clamp01(t);
      const floatIndex = clamped * (count - 1);
      const lo = Math.floor(floatIndex);
      const hi = Math.min(lo + 1, count - 1);
      const u = floatIndex - lo;
      const p = lerpVec(readVec(positions, lo), readVec(positions, hi), u);
      const tan = normalize(lerpVec(readVec(tangents, lo), readVec(tangents, hi), u));
      const nor = normalize(lerpVec(readVec(normals, lo), readVec(normals, hi), u));
      return { position: p, tangent: tan, normal: nor, index: lo };
    },
  };
  return api;
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(Math.max(t, 0), 1);
}
function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}
function readVec(buffer: Float32Array, index: number): Vec3 {
  return { x: buffer[index * 3]!, y: buffer[index * 3 + 1]!, z: buffer[index * 3 + 2]! };
}
function lerpVec(a: Vec3, b: Vec3, u: number): Vec3 {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
}

/**
 * Detect corners from heading change between consecutive cross-sections.
 * A positive `angleDeg` is a right-hand corner, negative is left-hand.
 *
 * Used by #APEX-18 for pace notes and by tests to prove the spline is sane.
 */
export function detectCorners(spline: SampledSpline, thresholdDeg = 12): Corner[] {
  const corners: Corner[] = [];
  for (let i = 1; i < spline.count - 1; i += 1) {
    const a = spline.tangentAt(i - 1);
    const b = spline.tangentAt(i + 1);
    const yawA = Math.atan2(a.x, a.z);
    const yawB = Math.atan2(b.x, b.z);
    let delta = ((yawB - yawA) * 180) / Math.PI;
    delta = ((delta + 540) % 360) - 180;
    if (Math.abs(delta) >= thresholdDeg) {
      corners.push({
        index: i,
        t: spline.ts[i]!,
        angleDeg: delta,
        direction: delta >= 0 ? "right" : "left",
      });
    }
  }
  return corners;
}

/** Project a sampled centreline to normalised 2-D minimap space (0..1). */
export function projectSplineToMinimap(spline: SampledSpline): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < spline.count; i += 1) {
    const p = spline.positionAt(i);
    points.push({ x: p.x, y: p.z });
  }
  return normaliseMinimap(points);
}

/** Fit 2-D points into [0,1]×[0,1] preserving aspect ratio; z is flipped for screen space. */
export function normaliseMinimap(points: Vec2[]): Vec2[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);
  const padX = (1 - spanX / span) / 2;
  const padY = (1 - spanY / span) / 2;
  return points.map((p) => ({
    x: padX + (p.x - minX) / span,
    // minimap draws with y increasing downwards, so flip the world z axis.
    y: 1 - (padY + (p.y - minY) / span),
  }));
}
