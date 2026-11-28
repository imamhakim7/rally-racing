/**
 * Spatial audio maths (#APEX-17).
 *
 * Pure, headless helpers for positioning sources against the listener. The
 * player's engine/tyre bus sits at the car (the listener is the chase camera);
 * opponent cars are placed by the Web Audio port's HRTF panners. Keeping the
 * maths here means the attenuation and pan behaviour is unit-tested without an
 * `AudioContext`.
 */

export interface ListenerState {
  x: number;
  y: number;
  z: number;
  /** Facing, radians, where forward is `(sin yaw, cos yaw)` in the x/z plane. */
  yaw: number;
}

export interface SourceState {
  x: number;
  y?: number;
  z: number;
}

export interface AttenuationOptions {
  /** Distance inside which the source is at full gain. Default 8 m. */
  refDistance?: number;
  /** Distance at which the source is silent. Default 220 m. */
  maxDistance?: number;
  /** Inverse-distance rolloff steepness. Default 1.4. */
  rolloff?: number;
}

export const ATTENUATION = {
  refDistance: 8,
  maxDistance: 220,
  rolloff: 1.4,
} as const;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value <= lo) return lo;
  if (value >= hi) return hi;
  return value;
}

/** Horizontal distance between two points in the x/z plane. */
export function planarDistance(a: SourceState, b: SourceState): number {
  return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
}

/**
 * Inverse-distance attenuation with a window that reaches exactly `0` at
 * `maxDistance`. `1` inside `refDistance`, strictly decreasing beyond it.
 */
export function attenuationGain(distance: number, options: AttenuationOptions = {}): number {
  const ref = finite(options.refDistance ?? ATTENUATION.refDistance, ATTENUATION.refDistance);
  const max = finite(options.maxDistance ?? ATTENUATION.maxDistance, ATTENUATION.maxDistance);
  const rolloff = finite(options.rolloff ?? ATTENUATION.rolloff, ATTENUATION.rolloff);
  const d = finite(distance, 0);
  if (d <= ref || max <= ref) return 1;
  if (d >= max) return 0;
  const inverse = ref / (ref + rolloff * (d - ref));
  const window = 1 - (d - ref) / (max - ref);
  return clamp(inverse * window, 0, 1);
}

/**
 * Stereo pan `[-1, 1]` for a source relative to the listener's facing: `-1` hard
 * left, `0` directly ahead/behind, `1` hard right. A source at the listener has
 * pan `0`.
 */
export function panForSource(source: SourceState, listener: ListenerState): number {
  const dx = finite(source.x, listener.x) - listener.x;
  const dz = finite(source.z, listener.z) - listener.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return 0;
  // Right vector for forward = (sin yaw, cos yaw) is (cos yaw, -sin yaw).
  const rightX = Math.cos(listener.yaw);
  const rightZ = -Math.sin(listener.yaw);
  const lateral = (dx * rightX + dz * rightZ) / distance;
  return clamp(lateral, -1, 1);
}

/** The yaw that faces the car from the camera, in the x/z plane. */
export function chaseYaw(camera: SourceState, car: SourceState): number {
  return Math.atan2(car.x - camera.x, car.z - camera.z);
}

/**
 * Build the listener state. The chase camera owns the position; its facing is
 * derived from camera→car unless an explicit yaw is given. With no camera the
 * listener sits on the car (a cockpit listener).
 */
export function listenerFromCar(
  car: SourceState,
  camera?: SourceState | null,
  yaw?: number,
): ListenerState {
  const position = camera ?? car;
  const facing = yaw ?? (camera ? chaseYaw(camera, car) : 0);
  return {
    x: finite(position.x, 0),
    y: finite(position.y ?? 0, 0),
    z: finite(position.z, 0),
    yaw: finite(facing, 0),
  };
}
