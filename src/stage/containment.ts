/**
 * Roadside containment (#APEX-28).
 *
 * A soft barrier that projects a car back onto the drivable corridor when it runs
 * wide, damps its lateral velocity and bleeds off speed on contact. It is a pure
 * function of `(circuit, spline)` and mutates nothing until `apply` is called, so
 * it is deterministic and headlessly testable, and the same code contains the CPU
 * field (#APEX-7) and any player vehicle (#APEX-2) that shares `Vehicle`'s
 * `getState`/`setState` surface.
 */
import type {
  ContainableVehicle,
  Containment,
  ContainmentResult,
  StageCircuit,
  Vec3,
} from "./types";
import type { SampledSpline } from "./spline";

/** Extra drivable shoulder beyond the road edge, in metres. */
export const DEFAULT_CONTAINMENT_SHOULDER = 4;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * Create the corridor containment for a circuit.
 *
 * @param circuit validated stage (#APEX-4)
 * @param spline  the same sampled centreline the road is built from
 * @param shoulder extra metres each side of the road edge (default 4)
 */
export function createContainment(
  circuit: StageCircuit,
  spline: SampledSpline,
  shoulder = DEFAULT_CONTAINMENT_SHOULDER,
): Containment {
  const halfWidth = circuit.road.width / 2 + Math.max(0, shoulder);
  const lastIndex = Math.max(spline.count - 1, 1);

  function project(x: number, z: number): { t: number; lateral: number; position: Vec3; normal: Vec3; heading: number } {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < spline.count; i += 1) {
      const p = spline.positionAt(i);
      const dx = x - p.x;
      const dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIndex = i;
      }
    }
    const t = bestIndex / lastIndex;
    const frame = spline.sampleAtT(t);
    const lateral =
      (x - frame.position.x) * frame.normal.x + (z - frame.position.z) * frame.normal.z;
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
    return { t, lateral, position: frame.position, normal: frame.normal, heading };
  }

  function resolve(x: number, z: number, _yaw: number): ContainmentResult {
    const projection = project(x, z);
    const lateral = projection.lateral;
    if (Math.abs(lateral) <= halfWidth + 1e-9) {
      return {
        contained: false,
        lateral,
        limit: halfWidth,
        impact: 1,
        position: { x, y: projection.position.y, z },
        t: projection.t,
      };
    }
    const sign = lateral >= 0 ? 1 : -1;
    const overshoot = Math.abs(lateral) - halfWidth;
    const impact = clamp(1 - overshoot / Math.max(halfWidth, 1), 0.25, 0.9);
    return {
      contained: true,
      lateral,
      limit: halfWidth,
      impact,
      position: {
        x: projection.position.x + projection.normal.x * sign * halfWidth,
        y: projection.position.y,
        z: projection.position.z + projection.normal.z * sign * halfWidth,
      },
      t: projection.t,
    };
  }

  return {
    halfWidth,
    shoulder: Math.max(0, shoulder),
    project,
    resolve,
    apply(vehicle: ContainableVehicle): ContainmentResult {
      const state = vehicle.getState();
      const result = resolve(state.x, state.z, state.yaw);
      if (result.contained) {
        vehicle.setState({
          x: result.position.x,
          z: result.position.z,
          vLat: 0,
          vLong: state.vLong * result.impact,
        });
      }
      return result;
    },
  };
}
