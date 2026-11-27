/**
 * Physics test scene — the drivable rally car on the four-surface test track.
 *
 * It is a normal `SceneHandle` (so `EngineApp` drives it exactly like the
 * bootstrap scene) plus a handful of test/inspection accessors: the vehicle,
 * the surface map and the freshest telemetry. The car is stepped once per fixed
 * `update(dt)` and rendered with interpolation, so the on-screen path is
 * smooth while the physics stays deterministic.
 */

import * as THREE from "three";
import type { SceneHandle } from "../engine/scene";
import {
  createLaneSurfaceMap,
  type Surface,
  type SurfaceMap,
} from "../physics/surface";
import {
  NEUTRAL_INPUT,
  Vehicle,
  type VehicleInput,
  type VehicleTelemetry,
} from "../physics/vehicle";
import { buildCarMesh } from "./carMesh";

export interface PhysicsTestSceneOptions {
  vehicle?: Vehicle;
  surfaceMap?: SurfaceMap;
  /** Called every update to pull the latest driver command (e.g. keyboard). */
  input?: () => VehicleInput;
  /** Called once per fixed step with the freshest telemetry and surface. */
  onTelemetry?: (telemetry: VehicleTelemetry, surface: Surface) => void;
  /** Start pose. Defaults to the middle of the tarmac lane, facing +Z. */
  startX?: number;
  startZ?: number;
  startYaw?: number;
}

export interface PhysicsTestScene extends SceneHandle {
  readonly vehicle: Vehicle;
  readonly surfaceMap: SurfaceMap;
  /** Surface under the car as of the last update. */
  readonly surface: Surface;
  setInput(input: VehicleInput): void;
}

const LANE_WIDTH = 12;
const LANE_LENGTH = 320;

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

function buildCar(): THREE.Group {
  return buildCarMesh();
}

export function createPhysicsTestScene(
  options: PhysicsTestSceneOptions = {},
): PhysicsTestScene {
  const vehicle = options.vehicle ?? new Vehicle();
  const surfaceMap = options.surfaceMap ?? createLaneSurfaceMap(LANE_WIDTH);
  const start = {
    x: options.startX ?? LANE_WIDTH / 2,
    z: options.startZ ?? -120,
    yaw: options.startYaw ?? 0,
  };
  vehicle.reset(start);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 40, 140);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0x94c6ff, 0x2a2118, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(20, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  for (const zone of surfaceMap.zones) {
    const surface = surfaceMap.surfaceAt((zone.minX + zone.maxX) / 2, 0);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.maxX - zone.minX, LANE_LENGTH),
      new THREE.MeshStandardMaterial({ color: surface.color, roughness: 1, metalness: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((zone.minX + zone.maxX) / 2, 0, (zone.minZ + zone.maxZ) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const grid = new THREE.GridHelper(LANE_LENGTH, 40, 0x8ea36a, 0x5a6b45);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.22;
  grid.position.y = 0.002;
  scene.add(grid);

  const car = buildCar();
  scene.add(car);

  let heldInput: VehicleInput = { ...NEUTRAL_INPUT };
  let currentSurface: Surface = surfaceMap.surfaceAt(start.x, start.z);
  let telemetry: VehicleTelemetry = vehicle.telemetry();

  let previous = { x: start.x, z: start.z, yaw: start.yaw };
  let current = { x: start.x, z: start.z, yaw: start.yaw };
  let disposed = false;

  // Chase camera, expressed in the car's local frame.
  const cameraOffset = new THREE.Vector3(0, 4.2, -9);
  const cameraTarget = new THREE.Vector3();

  function applyCamera(alpha: number): void {
    const x = previous.x + (current.x - previous.x) * alpha;
    const z = previous.z + (current.z - previous.z) * alpha;
    const yaw = previous.yaw + (current.yaw - previous.yaw) * alpha;
    const offset = cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.set(x + offset.x, offset.y, z + offset.z);
    cameraTarget.set(x, 1.1, z);
    camera.lookAt(cameraTarget);
  }

  applyCamera(1);
  car.position.set(start.x, 0, start.z);
  car.rotation.y = start.yaw;

  return {
    scene,
    camera,
    vehicle,
    surfaceMap,
    get surface() {
      return currentSurface;
    },
    setInput(input) {
      heldInput = { ...input };
    },
    update(dt) {
      if (disposed) return;
      const input = options.input ? options.input() : heldInput;
      currentSurface = surfaceMap.surfaceAt(vehicle.getState().x, vehicle.getState().z);
      previous = { ...current };
      vehicle.step(input, dt, currentSurface);
      const state = vehicle.getState();
      current = { x: state.x, z: state.z, yaw: state.yaw };
      telemetry = vehicle.telemetry();
      options.onTelemetry?.(telemetry, currentSurface);
    },
    interpolate(alpha) {
      if (disposed) return;
      const t = Math.min(Math.max(alpha, 0), 1);
      car.position.x = previous.x + (current.x - previous.x) * t;
      car.position.z = previous.z + (current.z - previous.z) * t;
      car.rotation.y = previous.yaw + (current.yaw - previous.yaw) * t;
      applyCamera(t);
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
      disposeObject(scene);
      scene.clear();
    },
  };
}
