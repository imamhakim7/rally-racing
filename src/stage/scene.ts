/**
 * `SceneHandle` adapter for stage circuits.
 *
 * Provides a single three.js scene whose contents are swapped by `load(id)`. It
 * implements the engine's `SceneHandle` port, so `createEngine(canvas, {
 * sceneHandle })` renders the currently selected stage, and the stage select
 * can change circuits live without reloading the page (or the WebGL context).
 */
import * as THREE from "three";
import type { SceneHandle } from "../engine/scene";
import type { StageLibrary } from "./library";
import { buildStageWorld, disposeStageWorld } from "./world";
import type { StageCircuit, StageWorld } from "./types";

export interface StageSceneHandle extends SceneHandle {
  /** Swap to another stage by id; disposes the previous world. Returns the circuit. */
  load(id: string): StageCircuit;
  readonly current: StageCircuit;
  readonly world: StageWorld;
}

function frameCamera(camera: THREE.PerspectiveCamera, circuit: StageCircuit): void {
  const points = circuit.spline.points;
  const a = points[0]!;
  const b = points[1] ?? points[0]!;
  const forward = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  camera.position.set(a.x - forward.x * 22, a.y + 11, a.z - forward.z * 22);
  camera.lookAt(a.x + forward.x * 12, a.y + 1, a.z + forward.z * 12);
}

/** Build a scene handle that renders the stage selected from `library`. */
export function createStageScene(library: StageLibrary, initialId?: string): StageSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 80, 320);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);

  const hemi = new THREE.HemisphereLight(0x9dc4ff, 0x3a3126, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const firstId = initialId ?? library.list()[0]!.id;
  let world: StageWorld = buildStageWorld(library.load(firstId));
  scene.add(world.group);
  frameCamera(camera, world.circuit);

  let disposed = false;

  return {
    scene,
    camera,
    get current() {
      return world.circuit;
    },
    get world() {
      return world;
    },
    load(id) {
      if (disposed) throw new Error("stage scene is disposed");
      const circuit = library.load(id);
      if (circuit.id === world.circuit.id) return circuit;
      scene.remove(world.group);
      disposeStageWorld(world);
      world = buildStageWorld(circuit);
      scene.add(world.group);
      frameCamera(camera, circuit);
      return circuit;
    },
    update() {
      /* Static inspection scene: the race loop drives motion, not the loader. */
    },
    interpolate() {
      /* Nothing to interpolate until the vehicle (#APEX-2) drives the camera. */
    },
    resize(width, height) {
      const safeWidth = width > 0 ? width : 1;
      const safeHeight = height > 0 ? height : 1;
      camera.aspect = safeWidth / safeHeight;
      camera.updateProjectionMatrix();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeStageWorld(world);
      scene.clear();
    },
  };
}
