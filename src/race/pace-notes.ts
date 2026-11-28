/**
 * Co-driver pace notes, derived from a stage's corner geometry.
 *
 * The co-driver's job is to call the road ahead: every corner with a distance, a
 * direction and a severity. This module is the pure half of that job — it turns
 * the #APEX-4 arc-length centreline into an ordered `PaceNote[]`, and a
 * `PaceNoteTracker` advances cursors over that list as the car covers ground. It
 * imports **nothing** with a DOM, Web Audio or `three.js`; the optional speech
 * (see `voice.ts`) and the HUD panel are ports on top, so the whole pipeline is
 * deterministic and headless-testable.
 *
 * Corners are found from the *windowed* heading change of the sampled tangents: a
 * shipped rally stage is a smooth Catmull-Rom curve where the change between two
 * adjacent cross-sections is only a few degrees, so the meaningful signal is the
 * heading change over a short arc (~16 m). Contiguous same-sign windows are
 * grouped into one corner and its net heading change gives the severity.
 *
 * Notes are computed once per stage load; the per-frame scheduler is bounded by
 * the notes inside the lead window, not by the length of the stage.
 */
import type { SampledSpline } from "../stage/spline";

export type NoteDirection = "left" | "right";

/** One corner, called out. Distances are metres along the arc-length centreline. */
export interface PaceNote {
  /** 0-based index in stage order (nearest first). */
  index: number;
  /** Metres from the stage start to the corner's apex sample. */
  distance: number;
  /** Arc-length fraction of the apex, in [0,1]. */
  t: number;
  /** Which way the road bends. */
  direction: NoteDirection;
  /** 1 (flat-out kink) .. 6 (tightest / hairpin). */
  severity: number;
  /** Signed heading change in degrees; negative = left, positive = right. */
  angleDeg: number;
  /** Nearest checkpoint name if one sits on the corner, otherwise `null`. */
  label: string | null;
  /** The co-driver phrase, e.g. `"Right 3"` or `"Hairpin left"`. */
  call: string;
  /** Metres from the previous note (the stage start for the first). */
  gap: number;
}

export interface PaceNoteOptions {
  /** Heading change (deg) across the window that counts as a corner. Default 15. */
  thresholdDeg?: number;
  /** Arc length (m) of the heading-change window. Default 16. */
  windowMetres?: number;
  /** Corners closer together than this (m) are merged. Default 25. */
  minSpacing?: number;
  /** A checkpoint within this distance (m) names the corner. Default 40. */
  labelTolerance?: number;
  /** Checkpoints whose names can label a corner (usually `circuit.checkpoints`). */
  checkpoints?: readonly { name: string; t: number }[];
}

export interface PaceNoteTrackerOptions {
  /** How far ahead (m) notes are surfaced and called. Default 320. */
  leadDistance?: number;
  /** 0 = sparse (hairpins only, wide spacing) .. 1 = dense (every corner). Default 0.6. */
  density?: number;
}

/** The scheduler's read-only projection, ready for the HUD and the voice port. */
export interface PaceNoteView {
  /** False when the stage carries no usable corners. */
  hasNotes: boolean;
  /** The corner most recently reached, or `null` before the first. */
  current: PaceNote | null;
  /** Notes ahead within the lead distance, nearest first. */
  upcoming: PaceNote[];
  /** The next note to call, or `null` when none remain within the lead distance. */
  next: PaceNote | null;
  /** Metres from the car to `next`, or `null` when there is no note ahead. */
  nextDistance: number | null;
  /** HUD/voice text, e.g. `"Right 3 · 240 m"`, `"No notes ahead"` or `"No notes"`. */
  nextText: string;
}

const DEFAULT_THRESHOLD_DEG = 15;
const DEFAULT_WINDOW_METRES = 16;
const DEFAULT_MIN_SPACING = 25;
const DEFAULT_LABEL_TOLERANCE = 40;
const DEFAULT_LEAD_DISTANCE = 320;
const DEFAULT_DENSITY = 0.6;

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Rally severity for a heading change: 1 = flat-out kink, 6 = hairpin. */
export function severityForAngle(angleDeg: number): number {
  const a = Math.abs(angleDeg);
  if (a >= 150) return 6;
  if (a >= 100) return 5;
  if (a >= 70) return 4;
  if (a >= 45) return 3;
  if (a >= 25) return 2;
  return 1;
}

/** The co-driver phrase for a corner, e.g. `"Right 3"` / `"Hairpin left"`. */
export function noteCall(
  direction: NoteDirection,
  angleDeg: number,
  severity: number,
): string {
  if (Math.abs(angleDeg) >= 130) return `Hairpin ${direction}`;
  return `${direction === "right" ? "Right" : "Left"} ${severity}`;
}

interface CornerGroup {
  peakIndex: number;
  angleDeg: number;
}

function wrapDeg(degrees: number): number {
  return ((degrees + 540) % 360) - 180;
}

function headingDeg(spline: SampledSpline, index: number): number {
  const tangent = spline.tangentAt(index);
  return (Math.atan2(tangent.x, tangent.z) * 180) / Math.PI;
}

/**
 * Find bends from the windowed heading change of the sampled tangents.
 *
 * For each sample `i` the *net* heading change over `±window` samples is measured;
 * a run of same-sign samples above the threshold is one corner. Summing adjacent
 * samples would double-count a smooth bend, so the corner's angle is the single
 * heading change across its full span. The apex is the sample with the largest
 * windowed change in the run.
 */
function groupCorners(
  spline: SampledSpline,
  thresholdDeg: number,
  windowMetres: number,
): CornerGroup[] {
  if (spline.count < 3) return [];
  const span = spline.length;
  const ds = span / (spline.count - 1);
  const window = Math.max(1, Math.round(windowMetres / (ds > 1e-6 ? ds : 1)));
  if (spline.count <= 2 * window) return [];

  const heading = new Float64Array(spline.count);
  for (let i = 0; i < spline.count; i += 1) heading[i] = headingDeg(spline, i);

  const delta = new Float64Array(spline.count);
  for (let i = window; i <= spline.count - 1 - window; i += 1) {
    delta[i] = wrapDeg(heading[i + window]! - heading[i - window]!);
  }

  const groups: CornerGroup[] = [];
  let start = -1;
  let end = -1;
  let peakIndex = -1;
  let peakAbs = 0;
  let sign = 0;

  const flush = (): void => {
    if (start < 0) return;
    const net = wrapDeg(heading[end + window]! - heading[start - window]!);
    const angleDeg = net !== 0 ? net : sign * Math.abs(delta[peakIndex]!);
    groups.push({ peakIndex, angleDeg: clamp(angleDeg, -180, 180) });
    start = -1;
    end = -1;
    peakIndex = -1;
    peakAbs = 0;
    sign = 0;
  };

  for (let i = window; i <= spline.count - 1 - window; i += 1) {
    const magnitude = Math.abs(delta[i]!);
    const inCorner = magnitude >= thresholdDeg;
    if (!inCorner) {
      flush();
      continue;
    }
    const currentSign = Math.sign(delta[i]!);
    if (start < 0) {
      start = i;
      sign = currentSign;
    } else if (currentSign !== sign && i - end > window) {
      // A reversal far enough away is a new corner (an S-bend).
      flush();
      start = i;
      sign = currentSign;
    }
    end = i;
    if (magnitude > peakAbs) {
      peakAbs = magnitude;
      peakIndex = i;
    }
  }
  flush();
  return groups;
}

/**
 * Derive the ordered pace notes for a stage from its sampled centreline.
 *
 * Pure and deterministic: the same `(spline, options)` always yields the same
 * notes. Returns `[]` for a degenerate spline or one with no detectable corners.
 */
export function buildPaceNotes(
  spline: SampledSpline,
  options: PaceNoteOptions = {},
): PaceNote[] {
  if (!spline || spline.count < 2 || !(spline.length > 0)) return [];

  const thresholdDeg = options.thresholdDeg ?? DEFAULT_THRESHOLD_DEG;
  const windowMetres = options.windowMetres ?? DEFAULT_WINDOW_METRES;
  const minSpacing = Math.max(0, options.minSpacing ?? DEFAULT_MIN_SPACING);
  const labelTolerance = Math.max(0, options.labelTolerance ?? DEFAULT_LABEL_TOLERANCE);
  const checkpoints = options.checkpoints ?? [];

  const groups = groupCorners(spline, thresholdDeg, windowMetres).sort(
    (a, b) => spline.distances[a.peakIndex]! - spline.distances[b.peakIndex]!,
  );

  const candidates: Omit<PaceNote, "index" | "gap">[] = groups.map((group) => {
    const angleDeg = clamp(group.angleDeg, -180, 180);
    const direction: NoteDirection = angleDeg >= 0 ? "right" : "left";
    const severity = severityForAngle(angleDeg);
    const distance = spline.distances[group.peakIndex]!;
    const t = spline.ts[group.peakIndex]!;

    let label: string | null = null;
    let bestLabel = labelTolerance;
    for (const checkpoint of checkpoints) {
      const cpDistance = spline.distanceAtT(checkpoint.t);
      const delta = Math.abs(cpDistance - distance);
      if (delta <= bestLabel) {
        bestLabel = delta;
        label = checkpoint.name;
      }
    }

    return {
      distance,
      t,
      direction,
      severity,
      angleDeg,
      label,
      call: noteCall(direction, angleDeg, severity),
    };
  });

  // Density spacing: merge notes closer than `minSpacing`, keeping the more severe.
  const kept: Omit<PaceNote, "index" | "gap">[] = [];
  for (const note of candidates) {
    const previous = kept[kept.length - 1];
    if (previous && note.distance - previous.distance < minSpacing) {
      if (note.severity > previous.severity) kept[kept.length - 1] = note;
      continue;
    }
    kept.push(note);
  }

  let previousDistance = 0;
  return kept.map((note, index) => {
    const gap = Math.max(0, note.distance - previousDistance);
    previousDistance = note.distance;
    return { ...note, index, gap };
  });
}

/**
 * Arc-distance (metres from the start) of the centreline sample nearest a world
 * point in the x/z plane. Bounded and always finite; used to advance the notes
 * from the car's position. O(samples).
 */
export function nearestDistanceOnSpline(spline: SampledSpline, x: number, z: number): number {
  if (!spline || spline.count < 1) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  let bestIndex = 0;
  let bestSq = Infinity;
  for (let i = 0; i < spline.count; i += 1) {
    const dx = spline.positions[i * 3]! - x;
    const dz = spline.positions[i * 3 + 2]! - z;
    const sq = dx * dx + dz * dz;
    if (sq < bestSq) {
      bestSq = sq;
      bestIndex = i;
    }
  }
  return spline.distances[bestIndex]!;
}

/** First index whose `distance` is strictly greater than `value` (binary search). */
function upperBound(notes: readonly PaceNote[], value: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid]!.distance <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function formatMetres(value: number): string {
  const metres = Math.max(0, Math.round(value));
  return `${metres} m`;
}

/**
 * Advances pace notes with the car. Holds the full note list and projects a view
 * of the current/upcoming/next calls for the HUD and the voice.
 *
 * `setDensity` filters which corners survive (severity floor + minimum spacing)
 * and `setLeadDistance` sets how far ahead they are surfaced; both are tunable at
 * runtime. The per-call scan is bounded by the notes within the lead window.
 */
export class PaceNoteTracker {
  private readonly allNotes: readonly PaceNote[];
  private leadDistance: number;
  private density: number;
  private distance = 0;
  private visible: PaceNote[] = [];
  /**
   * Notes already voiced, keyed by their stable arc-distance. A positional
   * cursor cannot survive `setDensity`/`setLeadDistance` re-filtering the
   * visible list (a note already called gets re-called, or a nearer note the
   * filter just revealed gets skipped); identity is invariant across rebuilds.
   */
  private readonly announced = new Set<number>();

  constructor(notes: readonly PaceNote[], options: PaceNoteTrackerOptions = {}) {
    this.allNotes = [...notes];
    this.leadDistance = Math.max(0, options.leadDistance ?? DEFAULT_LEAD_DISTANCE);
    this.density = clamp01(options.density ?? DEFAULT_DENSITY);
    this.rebuildVisible();
  }

  /** Every note derived for the stage, unfiltered. */
  get notes(): readonly PaceNote[] {
    return this.allNotes;
  }

  /** How far ahead (m) notes are surfaced and called. */
  get lead(): number {
    return this.leadDistance;
  }

  /** The density filter in [0,1]. */
  get densityValue(): number {
    return this.density;
  }

  setLeadDistance(metres: number): void {
    this.leadDistance = Math.max(0, Number.isFinite(metres) ? metres : DEFAULT_LEAD_DISTANCE);
  }

  setDensity(density01: number): void {
    const next = clamp01(density01);
    if (next === this.density) return;
    this.density = next;
    this.rebuildVisible();
  }

  /** Advance the car to an absolute arc-distance along the stage (metres). */
  setDistance(metres: number): void {
    if (!Number.isFinite(metres)) return;
    this.distance = Math.max(0, metres);
  }

  /** The current projection: current / upcoming / next note (see `PaceNoteView`). */
  view(): PaceNoteView {
    const hasNotes = this.visible.length > 0;
    const nextIndex = upperBound(this.visible, this.distance);
    const next = this.visible[nextIndex] ?? null;
    const current = nextIndex > 0 ? this.visible[nextIndex - 1]! : null;

    const upcoming: PaceNote[] = [];
    for (let i = nextIndex; i < this.visible.length; i += 1) {
      const note = this.visible[i]!;
      if (note.distance - this.distance > this.leadDistance) break;
      upcoming.push(note);
    }

    let nextText: string;
    if (!hasNotes) nextText = "No notes";
    else if (!next) nextText = "No notes ahead";
    else nextText = `${next.call} · ${formatMetres(next.distance - this.distance)}`;

    const nextDistance = next ? Math.max(0, next.distance - this.distance) : null;

    return { hasNotes, current, upcoming, next, nextDistance, nextText };
  }

  /**
   * The note to voice exactly once as it enters the lead window, or `null`. The
   * voice port calls this each frame; a note is returned a single time.
   */
  pollAnnouncement(): PaceNote | null {
    const nextIndex = upperBound(this.visible, this.distance);
    const note = this.visible[nextIndex];
    if (!note) return null;
    if (note.distance - this.distance > this.leadDistance) return null;
    if (this.announced.has(note.distance)) return null;
    this.announced.add(note.distance);
    return note;
  }

  /** Clear announcement state (e.g. on restart) without changing the notes. */
  reset(): void {
    this.distance = 0;
    this.announced.clear();
  }

  private rebuildVisible(): void {
    const minSeverity = Math.round(lerp(5, 1, this.density));
    const minSpacing = lerp(160, 15, this.density);
    const visible: PaceNote[] = [];
    let lastDistance = Number.NEGATIVE_INFINITY;
    for (const note of this.allNotes) {
      if (note.severity < minSeverity) continue;
      if (note.distance - lastDistance < minSpacing) continue;
      visible.push(note);
      lastDistance = note.distance;
    }
    this.visible = visible;
    // Announcement state is keyed by note identity, so it needs no re-derivation
    // when the filter changes: notes already called stay called, and newly
    // revealed notes are not marked as if they had been.
  }
}
