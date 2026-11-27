/**
 * Stage world assembly.
 *
 * Turns a validated `StageCircuit` into a `THREE.Group` containing the road
 * ribbon, a checkpoint gantry per checkpoint (plus the finish), the start line
 * and the resolved surface spans. Gate transforms and the world bounds are
 * returned alongside the scene graph so the race loop (#APEX-3), physics
 * (#APEX-2) and culling (#APEX-13) do not have to re-derive them.
 */
import * as THREE from "three";
import type {
  ResolvedGate,
  StageCircuit,
  StageWorld,
  Vec3,
} from "./types";
import { sampleSpline, type SampledSpline } from "./spline";
import { buildRoadGeometry, resolveSurfaceSpans, surfaceAt } from "./road";
import { resolveMinimapPath } from "./minimap";

const CHECKPOINT_COLOR = 0x38bdf8;
const FINISH_COLOR = 0xf2c94c;
const START_COLOR = 0xf8fafc;

function boxMesh(width: number, height: number, depth: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A two-post gantry across the road. Local +x spans the gate width, +z points
 * along the centreline tangent, so the caller only supplies a yaw.
 */
function createGate(width: number, height: number, color: number): THREE.Group {
  const gate = new THREE.Group();
  const postThickness = Math.max(0.18, width * 0.03);
  const left = boxMesh(postThickness, height, postThickness, color);
  left.position.set(-width / 2, height / 2, 0);
  const right = boxMesh(postThickness, height, postThickness, color);
  right.position.set(width / 2, height / 2, 0);
  const beam = boxMesh(width + postThickness, postThickness, postThickness, color);
  beam.position.set(0, height, 0);
  gate.add(left, right, beam);
  return gate;
}

function headingFromTangent(tangent: Vec3): number {
  return Math.atan2(tangent.x, tangent.z);
}

function resolveGate(
  circuit: StageCircuit,
  spline: SampledSpline,
  spec: { id: string; name: string; t: number; width: number; height: number },
  index: number,
  kind: ResolvedGate["kind"],
): ResolvedGate {
  const frame = spline.sampleAtT(spec.t);
  return {
    id: spec.id,
    name: spec.name,
    index,
    kind,
    t: spec.t,
    position: frame.position,
    heading: headingFromTangent(frame.tangent),
    width: spec.width,
    height: spec.height,
    surface: surfaceAt(circuit, spec.t),
  };
}

/**
 * Build the three.js world for a circuit.
 *
 * The road mesh geometry is generated entirely from the spline; the vertex count
 * is always `2 × samples`.
 */
export function buildStageWorld(circuit: StageCircuit): StageWorld {
  const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
  const spans = resolveSurfaceSpans(circuit, spline);
  const roadBuild = buildRoadGeometry(spline, circuit.road, spans);

  const group = new THREE.Group();
  group.name = `stage:${circuit.id}`;

  const road = new THREE.Mesh(
    roadBuild.geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  );
  road.name = "road";
  road.receiveShadow = true;
  group.add(road);

  // Start line: a thin stripe across the road at t=0.
  const startFrame = spline.sampleAtT(0);
  const startLine = boxMesh(circuit.road.width, 0.05, 0.6, START_COLOR);
  startLine.name = "start-line";
  startLine.position.set(startFrame.position.x, startFrame.position.y + 0.03, startFrame.position.z);
  startLine.rotation.y = headingFromTangent(startFrame.tangent);
  group.add(startLine);

  const gates: ResolvedGate[] = [];
  circuit.checkpoints.forEach((cp, i) => {
    const resolved = resolveGate(circuit, spline, cp, i, "checkpoint");
    const mesh = createGate(cp.width, cp.height, CHECKPOINT_COLOR);
    mesh.name = `gate:${cp.id}`;
    mesh.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
    mesh.rotation.y = resolved.heading;
    group.add(mesh);
    gates.push(resolved);
  });

  const finishResolved = resolveGate(
    circuit,
    spline,
    { id: "finish", name: "Finish", t: circuit.finish.t, width: circuit.finish.gate.width, height: circuit.finish.gate.height },
    gates.length,
    "finish",
  );
  const finishMesh = createGate(circuit.finish.gate.width, circuit.finish.gate.height, FINISH_COLOR);
  finishMesh.name = "gate:finish";
  finishMesh.position.set(finishResolved.position.x, finishResolved.position.y, finishResolved.position.z);
  finishMesh.rotation.y = finishResolved.heading;
  group.add(finishMesh);
  gates.push(finishResolved);

  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const minimap = resolveMinimapPath(circuit.minimap, spline);

  return { circuit, group, gates, surfaces: spans, road, bounds, minimap };
}

/** Release every geometry/material the world created. Idempotent. */
export function disposeStageWorld(world: StageWorld): void {
  world.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else if (material) {
      material.dispose();
    }
  });
  world.group.clear();
}
