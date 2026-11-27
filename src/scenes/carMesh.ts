/**
 * Shared boxy rally-car mesh.
 *
 * Used by the physics test scene (#APEX-2) and the visible AI race scene
 * (#APEX-7) so there is one car appearance to maintain. Detailed art arrives
 * with the asset pipeline; this is a readable stand-in with shadows.
 */
import * as THREE from "three";

export function buildCarMesh(color = 0xd23c3c): THREE.Group {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 3.6),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 }),
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
  return car;
}
