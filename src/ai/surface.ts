/**
 * Stage-surface adapter for the vehicle model.
 *
 * #APEX-4 describes a road as a list of surface zones (`tarmac | gravel | dirt |
 * grass | water | sand | snow | mud`) each with an absolute `grip` scalar.
 * #APEX-2's `Vehicle` only knows four physics surfaces. Rather than let the car
 * feel like generic gravel everywhere, this module maps a stage zone to the
 * nearest physics surface for rolling resistance/id but takes the grip values
 * **from the zone data**, so the car grips exactly what the road paint shows.
 */
import type { Surface, SurfaceId } from "../physics/surface";
import type { StageCircuit, SurfaceType } from "../stage/types";

/** Nearest physics surface for a stage surface type (drives rolling resistance). */
const PHYSICS_SURFACE: Record<SurfaceType, SurfaceId> = {
  tarmac: "tarmac",
  gravel: "gravel",
  dirt: "gravel",
  sand: "gravel",
  grass: "gravel",
  snow: "mud",
  mud: "mud",
  water: "mud",
};

const ROLLING: Record<SurfaceId, number> = {
  tarmac: 0.012,
  gravel: 0.02,
  mud: 0.035,
  ice: 0.008,
};

const LABEL: Record<SurfaceType, string> = {
  tarmac: "Tarmac",
  gravel: "Gravel",
  dirt: "Dirt",
  grass: "Grass",
  water: "Water",
  sand: "Sand",
  snow: "Snow",
  mud: "Mud",
};

export interface PhysicsSurface extends Surface {
  /** The stage surface type this was derived from. */
  stageType: SurfaceType;
  /** The zone's authored grip scalar (0..1). */
  grip: number;
}

function make(type: SurfaceType, grip: number): PhysicsSurface {
  const clamped = Math.min(Math.max(grip, 0.05), 1.5);
  const id = PHYSICS_SURFACE[type];
  return {
    id,
    stageType: type,
    grip: clamped,
    label: `${LABEL[type]} (${id})`,
    // Grip comes from the zone; rolling resistance from the physics class.
    lateralGrip: clamped,
    longitudinalGrip: clamped,
    rollingResistance: ROLLING[id],
    color: 0x000000,
  };
}

/**
 * The physics surface active at arc-length fraction `t`.
 *
 * Mirrors `stage/road.surfaceAt` but also carries the zone's grip, so a driver's
 * speed profile and the car's tyre forces read the same road.
 */
export function physicsSurfaceAt(circuit: StageCircuit, t: number): PhysicsSurface {
  const clamped = Math.min(Math.max(t, 0), 1);
  const zone = circuit.surfaces.find(
    (z) => clamped >= z.from && (clamped < z.to || z.to >= 1),
  );
  if (zone) return make(zone.surface, zone.grip);
  return make(circuit.road.surface, 0.8);
}
