import * as THREE from "three";

/**
 * Scene lifecycle contract. `resize` keeps the camera aspect in lockstep with
 * the canvas; `dispose` releases every geometry/material/texture created by the
 * scene so reloading the game cannot leak GPU memory.
 */
export interface SceneHandle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Advance simulation state by a fixed `dt` (no rendering). */
  update(dt: number): void;
  /** Apply render interpolation for `alpha` in [0,1) (no drawing). */
  interpolate(alpha: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

const CAR_SPIN_RATE = 0.6; // radians / second at the fixed step

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

/**
 * Build the placeholder scene used to prove the bootstrap: a lit ground plane,
 * a reference grid and a boxy stand-in "car" that slowly yaws. It exercises the
 * render pipeline, shadow map and interpolation without needing any assets.
 */
export function createPlaceholderScene(): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 18, 55);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(6, 4, 9);
  camera.lookAt(0, 0.6, 0);

  const hemi = new THREE.HemisphereLight(0x94c6ff, 0x2a2118, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(8, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x3b4a2f, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(120, 60, 0x8ea36a, 0x5a6b45);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  grid.position.y = 0.002;
  scene.add(grid);

  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 3.6),
    new THREE.MeshStandardMaterial({ color: 0xd23c3c, roughness: 0.45, metalness: 0.25 }),
  );
  body.position.y = 0.75;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.3, metalness: 0.4 }),
  );
  cabin.position.set(0, 1.35, -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  for (const [x, z] of [
    [0.9, 1.25],
    [-0.9, 1.25],
    [0.9, -1.25],
    [-0.9, -1.25],
  ] as const) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.28, 20),
      new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.9 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    wheel.castShadow = true;
    car.add(wheel);
  }
  car.position.y = 0.02;
  scene.add(car);

  let previousYaw = 0;
  let currentYaw = 0;
  let disposed = false;

  return {
    scene,
    camera,
    update(dt) {
      if (disposed) return;
      previousYaw = currentYaw;
      currentYaw += dt * CAR_SPIN_RATE;
    },
    interpolate(alpha) {
      const clamped = Math.min(Math.max(alpha, 0), 1);
      car.rotation.y = previousYaw + (currentYaw - previousYaw) * clamped;
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
