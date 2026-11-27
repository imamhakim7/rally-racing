/**
 * Road mesh generation.
 *
 * The road is a ribbon: one quad strip swept along the sampled centreline, width
 * `road.width`, with surface zones painted into a per-vertex colour attribute.
 * Nothing here is authored by hand — change the JSON and the mesh follows, which
 * is what makes adding a stage a content task rather than a programming one.
 */
import * as THREE from "three";
import type {
  ResolvedSurfaceSpan,
  RoadDef,
  StageCircuit,
  SurfaceType,
} from "./types";
import type { SampledSpline } from "./spline";

/** Colour per surface type (used for the vertex-colour paint + the legend). */
export const SURFACE_COLORS: Record<SurfaceType, number> = {
  tarmac: 0x4a4f57,
  gravel: 0x9c8b6a,
  dirt: 0x6f543a,
  grass: 0x5f7a3f,
  water: 0x2f6f8f,
  sand: 0xd8c48c,
  snow: 0xe8eef2,
  mud: 0x4b3b2a,
};

export interface RoadBuild {
  geometry: THREE.BufferGeometry;
  spans: ResolvedSurfaceSpan[];
  /** Vertex count of the ribbon (2 per cross-section). */
  vertexCount: number;
}

/**
 * Resolve surface zones to sample-index spans.
 *
 * Spans are inclusive over cross-sections and share their boundary sample, so
 * `span[i].startIndex === span[i-1].endIndex` — the tiling the validator
 * guarantees in the file is preserved in the mesh.
 */
export function resolveSurfaceSpans(circuit: StageCircuit, spline: SampledSpline): ResolvedSurfaceSpan[] {
  const lastIndex = spline.count - 1;
  return circuit.surfaces.map((zone, i) => {
    const isLast = i === circuit.surfaces.length - 1;
    const startIndex = Math.min(Math.round(zone.from * lastIndex), lastIndex);
    const endIndex = isLast ? lastIndex : Math.min(Math.round(zone.to * lastIndex), lastIndex);
    return {
      id: zone.id,
      surface: zone.surface,
      from: zone.from,
      to: zone.to,
      grip: zone.grip,
      ...(zone.depth !== undefined ? { depth: zone.depth } : {}),
      startIndex,
      endIndex: Math.max(endIndex, startIndex + (isLast ? 0 : 1)),
    };
  });
}

/** The surface type active at arc-length fraction `t`. */
export function surfaceAt(circuit: StageCircuit, t: number): SurfaceType {
  const clamped = Math.min(Math.max(t, 0), 1);
  const zone = circuit.surfaces.find((z) => clamped >= z.from && (clamped < z.to || z.to >= 1));
  return zone?.surface ?? circuit.road.surface;
}

function spanForIndex(spans: ResolvedSurfaceSpan[], index: number): ResolvedSurfaceSpan | undefined {
  return spans.find((s) => index >= s.startIndex && index <= s.endIndex);
}

function bankingRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Build the road ribbon geometry from a sampled centreline.
 *
 * @param road  width/sampleStep/banking/default surface
 */
export function buildRoadGeometry(
  spline: SampledSpline,
  road: RoadDef,
  spans: ResolvedSurfaceSpan[],
): RoadBuild {
  const count = spline.count;
  const vertexCount = count * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const half = road.width / 2;
  const bank = bankingRadians(road.bankingDeg);

  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const position = spline.positionAt(i);
    const tangent = new THREE.Vector3(
      spline.tangentAt(i).x,
      spline.tangentAt(i).y,
      spline.tangentAt(i).z,
    ).normalize();
    const right = new THREE.Vector3(
      spline.normalAt(i).x,
      spline.normalAt(i).y,
      spline.normalAt(i).z,
    ).normalize();
    if (bank !== 0) right.applyAxisAngle(tangent, bank);

    const left = new THREE.Vector3(position.x, position.y, position.z).addScaledVector(right, -half);
    const rightPoint = new THREE.Vector3(position.x, position.y, position.z).addScaledVector(right, half);
    // Surface normal = tangent × right (right = up × tangent): it points up for a
    // level road and stays perpendicular to the road when banked. Using the
    // opposite cross order yields -up, whose blend with up cancels to the zero
    // vector for a flat stage (reviewer R1).
    const normal = new THREE.Vector3().crossVectors(tangent, right).normalize();

    const leftBase = i * 2 * 3;
    const rightBase = leftBase + 3;
    positions[leftBase] = left.x;
    positions[leftBase + 1] = left.y;
    positions[leftBase + 2] = left.z;
    positions[rightBase] = rightPoint.x;
    positions[rightBase + 1] = rightPoint.y;
    positions[rightBase + 2] = rightPoint.z;

    for (const base of [leftBase, rightBase]) {
      normals[base] = normal.x;
      normals[base + 1] = normal.y;
      normals[base + 2] = normal.z;
    }

    const uvBase = i * 2 * 2;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = spline.distances[i]!;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = spline.distances[i]!;

    const zone = spanForIndex(spans, i);
    const surface = zone?.surface ?? road.surface;
    color.setHex(SURFACE_COLORS[surface]);
    for (const base of [leftBase, rightBase]) {
      colors[base] = color.r;
      colors[base + 1] = color.g;
      colors[base + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const ll = i * 2;
    const rl = ll + 1;
    const ln = (i + 1) * 2;
    const rn = ln + 1;
    indices.push(ll, ln, rl);
    indices.push(rl, ln, rn);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return { geometry, spans, vertexCount };
}
