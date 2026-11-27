/**
 * Minimap path resolution.
 *
 * A stage's minimap is derived from the same centreline as the road: `"auto"`
 * projects the sampled spline into normalised 2-D space, while an explicit
 * `points` list overrides it for hand-tuned layouts. The path is exposed both as
 * points and as an SVG `d` string so the HUD (#APEX-10) can draw it directly.
 */
import type { MinimapSpec, Vec2 } from "./types";
import { normaliseMinimap, projectSplineToMinimap, type SampledSpline } from "./spline";

export interface MinimapPath {
  points: Vec2[];
  d: string;
}

/** Build a closed SVG path string from normalised points (0..1). */
export function toSvgPath(points: Vec2[], size = 1): string {
  if (points.length === 0) return "";
  const scaled = points.map((p) => ({ x: p.x * size, y: p.y * size }));
  const [first, ...rest] = scaled;
  const segments = rest.map((p) => `L ${p.x.toFixed(4)} ${p.y.toFixed(4)}`);
  return `M ${first!.x.toFixed(4)} ${first!.y.toFixed(4)} ${segments.join(" ")}`.trim();
}

/** Resolve a stage's minimap spec against its sampled centreline. */
export function resolveMinimapPath(minimap: MinimapSpec, spline: SampledSpline): MinimapPath {
  const points = minimap.path === "auto" ? projectSplineToMinimap(spline) : normaliseMinimap(minimap.path);
  return { points, d: toSvgPath(points) };
}
