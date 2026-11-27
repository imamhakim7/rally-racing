/**
 * Surface definitions for rally stages. Every surface exposes a lateral grip
 * (cornering) and longitudinal grip (drive/brake) coefficient as a multiplier
 * on the vehicle's baseline tyre forces, plus a rolling-resistance coefficient.
 *
 * The numbers are deliberately spread far apart so the handling difference is
 * measurable in a headless test, not just visible on screen:
 *
 *   tarmac  high grip, low drag   — the reference surface
 *   gravel  noticeably lower grip — slides wider, brakes longer
 *   mud     low grip, high drag   — slow and loose
 *   ice     very low grip         — almost no cornering authority
 */

export type SurfaceId = "tarmac" | "gravel" | "mud" | "ice";

export interface Surface {
  id: SurfaceId;
  /** Human label for the debug overlay. */
  label: string;
  /** Peak lateral (cornering) friction coefficient, as a multiplier on 1 g. */
  lateralGrip: number;
  /** Peak longitudinal (drive/brake) traction, as a multiplier on the engine. */
  longitudinalGrip: number;
  /** Rolling resistance, as a per-second damping coefficient on speed. */
  rollingResistance: number;
  /** Base colour used by the test scene ground and the overlay swatch. */
  color: number;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  tarmac: {
    id: "tarmac",
    label: "Tarmac",
    lateralGrip: 1.0,
    longitudinalGrip: 1.0,
    rollingResistance: 0.012,
    color: 0x3a3f46,
  },
  gravel: {
    id: "gravel",
    label: "Gravel",
    lateralGrip: 0.62,
    longitudinalGrip: 0.7,
    rollingResistance: 0.02,
    color: 0x8a7a5c,
  },
  mud: {
    id: "mud",
    label: "Mud",
    lateralGrip: 0.4,
    longitudinalGrip: 0.46,
    rollingResistance: 0.035,
    color: 0x4d3a26,
  },
  ice: {
    id: "ice",
    label: "Ice",
    lateralGrip: 0.14,
    longitudinalGrip: 0.18,
    rollingResistance: 0.008,
    color: 0xbfe3f0,
  },
};

export const SURFACE_IDS: readonly SurfaceId[] = ["tarmac", "gravel", "mud", "ice"];

export function getSurface(id: SurfaceId): Surface {
  return SURFACES[id];
}

/** An axis-aligned patch of ground mapped to one surface. */
export interface SurfaceZone {
  surface: SurfaceId;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * A lookup table of surface patches. `surfaceAt` returns the first zone that
 * contains the point, or the fallback surface when none match — so the test
 * scene can lay surfaces side by side and the vehicle samples the one it is on.
 */
export interface SurfaceMap {
  readonly zones: readonly SurfaceZone[];
  readonly fallback: SurfaceId;
  surfaceAt(x: number, z: number): Surface;
}

export function createSurfaceMap(
  zones: readonly SurfaceZone[],
  fallback: SurfaceId = "tarmac",
): SurfaceMap {
  return {
    zones,
    fallback,
    surfaceAt(x: number, z: number): Surface {
      for (const zone of zones) {
        if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
          return SURFACES[zone.surface];
        }
      }
      return SURFACES[fallback];
    },
  };
}

/**
 * The default layout for the physics test scene: four equal-width lanes running
 * along +Z (tarmac → gravel → mud → ice) so a driver can hit each surface in
 * turn and compare the same line.
 */
export function createLaneSurfaceMap(laneWidth = 12): SurfaceMap {
  const zones: SurfaceZone[] = SURFACE_IDS.map((surface, i) => ({
    surface,
    minX: i * laneWidth,
    maxX: (i + 1) * laneWidth,
    minZ: -160,
    maxZ: 160,
  }));
  return createSurfaceMap(zones, "tarmac");
}
