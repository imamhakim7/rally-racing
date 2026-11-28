/**
 * Visible AI race scene.
 *
 * A thin `SceneHandle` over the same field the headless simulator builds: it
 * renders #APEX-4's road and drives four CPU cars (#APEX-7) with a chase camera,
 * using the identical `CpuDriver` + `Vehicle` logic. It exists so the race can be
 * watched and captured as evidence — the authoritative race is `simulateRace`.
 */
import * as THREE from "three";
import type { SceneHandle } from "../engine/scene";
import { clamp } from "../physics/util";
import { buildStageWorld, disposeStageWorld } from "../stage/world";
import { sampleSpline } from "../stage/spline";
import type { StageCircuit, StageWorld } from "../stage/types";
import { createRaceField, parkOffLineCar } from "../ai/race";
import type { CpuDriver } from "../ai/driver";
import { physicsSurfaceAt } from "../ai/surface";
import { buildCarMesh } from "./carMesh";

export interface AiRaceSceneOptions {
  /** Deterministic skill seed (default 7). */
  seed?: number;
}

/** Per-car telemetry sample for playtest/QA tooling. */
export interface RaceCarSample {
  id: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** Offset from the road centreline (m); `|offset| <= roadHalfWidth` = on road. */
  centerOffset: number;
  /** Signed curvature at the car's line point (1/m). */
  curvature: number;
  progress: number;
  finished: boolean;
}

/** A frame of player-facing telemetry from the visible race. */
export interface RaceSnapshot {
  time: number;
  roadHalfWidth: number;
  leaderId: string;
  /** How many cars are inside the camera frustum this frame — are they visible? */
  onScreen: number;
  cars: RaceCarSample[];
}

export interface AiRaceScene extends SceneHandle {
  readonly circuitId: string;
  readonly carCount: number;
  readonly simulationTime: number;
  readonly leaderId: string;
  /** Arc-length progress of the leading car, 0..1. */
  readonly leaderProgress: number;
  readonly world: StageWorld;
  /** Sample every car plus camera visibility (used by the playtest harness). */
  snapshot(): RaceSnapshot;
}

const COLORS = [0xd23c3c, 0x38bdf8, 0xf2c94c, 0x5fbf7f, 0xc084fc, 0xfb923c];
const DT = 1 / 60;

export function createAiRaceScene(
  circuit: StageCircuit,
  options: AiRaceSceneOptions = {},
): AiRaceScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 90, 360);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3000);
  scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x3a3126, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const world = buildStageWorld(circuit);
  scene.add(world.group);

  const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
  const roadYAt = (t: number): number => spline.sampleAtT(clamp(t, 0, 1)).position.y;

  const { line, drivers } = createRaceField(circuit, { seed: options.seed ?? 7 });

  const carMeshes = drivers.map((driver, i) => {
    const car = buildCarMesh(COLORS[i % COLORS.length]!);
    const state = driver.vehicle.getState();
    car.position.set(state.x, roadYAt(clamp(driver.distance / Math.max(line.length, 1), 0, 1)), state.z);
    car.rotation.y = state.yaw;
    scene.add(car);
    return car;
  });

  let previous = drivers.map((d) => {
    const s = d.vehicle.getState();
    return { x: s.x, z: s.z, y: roadYAt(clamp(d.distance / Math.max(line.length, 1), 0, 1)), yaw: s.yaw };
  });
  let current = previous.map((p) => ({ ...p }));
  let simulationTime = 0;
  let disposed = false;

  function leader(): CpuDriver {
    return drivers.reduce((best, d) => (d.distance > best.distance ? d : best), drivers[0]!);
  }

  /** Cars still racing; falls back to all once everyone has finished. */
  function framedDrivers(): CpuDriver[] {
    const active = drivers.filter((d) => !d.finished);
    return active.length > 0 ? active : drivers;
  }

  /**
   * Spectator camera that frames the racing cars: it looks at their centroid and
   * pulls back as they spread out, so a race is watchable (a leader-only chase
   * loses the opponents as soon as the leader pulls away).
   */
  function applyCamera(alpha: number): void {
    const framed = framedDrivers();
    let cx = 0;
    let cz = 0;
    let forwardX = 0;
    let forwardZ = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const driver of framed) {
      const i = drivers.indexOf(driver);
      const a = previous[i]!;
      const b = current[i]!;
      const x = a.x + (b.x - a.x) * alpha;
      const z = a.z + (b.z - a.z) * alpha;
      const yaw = a.yaw + (b.yaw - a.yaw) * alpha;
      cx += x;
      cz += z;
      forwardX += Math.sin(yaw);
      forwardZ += Math.cos(yaw);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const n = framed.length;
    cx /= n;
    cz /= n;

    const len = Math.hypot(forwardX, forwardZ);
    if (len < 1e-6) {
      const frame = line.sampleAtDistance(leader().distance);
      forwardX = frame.tangent.x;
      forwardZ = frame.tangent.z;
    } else {
      forwardX /= len;
      forwardZ /= len;
    }

    const spread = Math.max(maxX - minX, maxZ - minZ);
    const distance = clamp(13 + spread * 0.8, 13, 46);
    const height = clamp(6 + spread * 0.45, 6, 20);
    camera.position.set(cx - forwardX * distance, height, cz - forwardZ * distance);
    camera.lookAt(cx + forwardX * 6, 1.2, cz + forwardZ * 6);
  }

  const projection = new THREE.Vector3();

  function countOnScreen(): number {
    camera.updateMatrixWorld();
    let count = 0;
    for (const driver of framedDrivers()) {
      const s = driver.vehicle.getState();
      projection.set(s.x, 1, s.z).project(camera);
      if (
        projection.x >= -1 &&
        projection.x <= 1 &&
        projection.y >= -1 &&
        projection.y <= 1 &&
        projection.z >= -1 &&
        projection.z <= 1
      ) {
        count += 1;
      }
    }
    return count;
  }

  applyCamera(1);

  return {
    scene,
    camera,
    circuitId: circuit.id,
    carCount: drivers.length,
    world,
    get simulationTime() {
      return simulationTime;
    },
    get leaderId() {
      return leader().id;
    },
    get leaderProgress() {
      return clamp(leader().distance / Math.max(line.length, 1), 0, 1);
    },
    snapshot() {
      return {
        time: simulationTime,
        roadHalfWidth: circuit.road.width / 2,
        leaderId: leader().id,
        onScreen: countOnScreen(),
        cars: drivers.map((driver) => {
          const s = driver.vehicle.getState();
          return {
            id: driver.id,
            x: s.x,
            z: s.z,
            yaw: s.yaw,
            speed: driver.speed(),
            centerOffset: driver.centerOffset,
            curvature: driver.curvature,
            progress: clamp(driver.distance / Math.max(line.length, 1), 0, 1),
            finished: driver.finished,
          };
        }),
      };
    },
    update(dt) {
      if (disposed) return;
      const step = dt > 0 && Number.isFinite(dt) ? dt : DT;
      simulationTime += step;

      const inputs = drivers.map((driver, i) => {
        if (driver.finished) return { throttle: 0, brake: 0.4, steer: 0, handbrake: false };
        const t = clamp(driver.distance / Math.max(line.length, 1), 0, 1);
        const command = driver.control(line, physicsSurfaceAt(circuit, t), drivers);
        if (driver.distance >= line.length - 0.5) {
          driver.markFinished(simulationTime);
          parkOffLineCar(driver, line, circuit.road.width / 2, i);
          return { throttle: 0, brake: 0.4, steer: 0, handbrake: false };
        }
        return command;
      });

      previous = current;
      current = drivers.map((driver, i) => {
        const t = clamp(driver.distance / Math.max(line.length, 1), 0, 1);
        const surface = physicsSurfaceAt(circuit, t);
        driver.vehicle.step(inputs[i]!, step, surface);
        // Soft roadside barrier: a car that runs wide is pulled back onto the
        // corridor and damped instead of driving on air (#APEX-28). Finished
        // cars are parked off the line on purpose, so they are exempt.
        if (!driver.finished) world.containment.apply(driver.vehicle);
        const s = driver.vehicle.getState();
        return { x: s.x, z: s.z, y: roadYAt(t), yaw: s.yaw };
      });
    },
    interpolate(alpha) {
      if (disposed) return;
      const t = clamp(alpha, 0, 1);
      for (let i = 0; i < carMeshes.length; i += 1) {
        const a = previous[i]!;
        const b = current[i]!;
        carMeshes[i]!.position.set(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t,
        );
        carMeshes[i]!.rotation.y = a.yaw + (b.yaw - a.yaw) * t;
      }
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
      disposeStageWorld(world);
      for (const car of carMeshes) {
        car.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = (mesh as { material?: THREE.Material }).material;
          material?.dispose();
        });
      }
      scene.clear();
    },
  };
}
