import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { validateStage } from "../src/stage/validate";
import { sampleSpline } from "../src/stage/spline";
import { buildStageWorld, disposeStageWorld } from "../src/stage/world";
import { clone, makeStageDocument } from "./stage-fixtures";

function fixtureCircuit() {
  return validateStage(clone(makeStageDocument()), "world.json");
}

describe("stage world", () => {
  it("generates the road mesh from the spline (AC2)", () => {
    const circuit = fixtureCircuit();
    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    const world = buildStageWorld(circuit);

    const position = world.road.geometry.getAttribute("position");
    // Two vertices (left + right) per cross-section.
    expect(position.count).toBe(spline.count * 2);
    expect(world.road.name).toBe("road");

    // The first cross-section's left/right pair is `road.width` apart.
    const left = new THREE.Vector3().fromBufferAttribute(position, 0);
    const right = new THREE.Vector3().fromBufferAttribute(position, 1);
    const width = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
    expect(width).toBeCloseTo(circuit.road.width, 4);

    disposeStageWorld(world);
  });

  it("resolves one gate per checkpoint plus the finish, in file order (AC3)", () => {
    const circuit = fixtureCircuit();
    const world = buildStageWorld(circuit);

    expect(world.gates).toHaveLength(circuit.checkpoints.length + 1);
    expect(world.gates.map((g) => g.id)).toEqual(["cp-1", "cp-2", "finish"]);
    expect(world.gates.at(-1)!.kind).toBe("finish");
    expect(world.gates.slice(0, -1).every((g) => g.kind === "checkpoint")).toBe(true);

    const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
    for (const gate of world.gates) {
      const expected = spline.sampleAtT(gate.t).position;
      expect(gate.position.x).toBeCloseTo(expected.x, 4);
      expect(gate.position.z).toBeCloseTo(expected.z, 4);
    }

    // Each gate has a matching scene-graph node.
    expect(world.group.getObjectByName("gate:cp-1")).toBeDefined();
    expect(world.group.getObjectByName("gate:finish")).toBeDefined();

    disposeStageWorld(world);
  });

  it("maps surface zones onto contiguous spans that tile the road (AC4)", () => {
    const circuit = fixtureCircuit();
    const world = buildStageWorld(circuit);
    const lastIndex = sampleSpline(circuit.spline, circuit.road.sampleStep).count - 1;

    expect(world.surfaces[0]!.startIndex).toBe(0);
    expect(world.surfaces.at(-1)!.endIndex).toBe(lastIndex);
    for (let i = 1; i < world.surfaces.length; i += 1) {
      expect(world.surfaces[i]!.startIndex).toBe(world.surfaces[i - 1]!.endIndex);
    }
    expect(world.surfaces.map((s) => s.grip)).toEqual([1, 0.7, 0.6]);

    disposeStageWorld(world);
  });

  it("resolves the minimap path from the file (AC5)", () => {
    const circuit = fixtureCircuit();
    const world = buildStageWorld(circuit);
    expect(world.minimap.points.length).toBeGreaterThan(1);
    expect(world.minimap.d.startsWith("M ")).toBe(true);
    disposeStageWorld(world);
  });

  it("computes bounds enclosing the road and gates (AC2)", () => {
    const circuit = fixtureCircuit();
    const world = buildStageWorld(circuit);
    const start = circuit.spline.points[0]!;
    expect(world.bounds.containsPoint(new THREE.Vector3(start.x, start.y, start.z))).toBe(true);
    expect(world.bounds.max.x).toBeGreaterThan(world.bounds.min.x);
    disposeStageWorld(world);
  });

  it("disposes every geometry exactly once", () => {
    const world = buildStageWorld(fixtureCircuit());
    const geometries: THREE.BufferGeometry[] = [];
    world.group.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.push(object.geometry);
    });
    const spies = geometries.map((geometry) => vi.spyOn(geometry, "dispose").mockImplementation(() => {}));

    disposeStageWorld(world);
    disposeStageWorld(world); // idempotent

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(world.group.children).toHaveLength(0);
  });

  it("orients the road's normals up and unit-length (regression: reviewer R1)", () => {
    const world = buildStageWorld(fixtureCircuit());
    const normal = world.road.geometry.getAttribute("normal");
    let minimumUp = Infinity;
    for (let i = 0; i < normal.count; i += 1) {
      const n = new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i));
      // Unit length (never the zero vector a degenerate cross product produces).
      expect(n.length()).toBeCloseTo(1, 3);
      minimumUp = Math.min(minimumUp, n.y);
    }
    // The fixture centreline is flat (y = 0), so a correctly oriented road faces up.
    expect(minimumUp).toBeGreaterThan(0.9);
    disposeStageWorld(world);
  });
});
