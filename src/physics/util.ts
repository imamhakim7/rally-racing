/** Tiny numeric helpers shared by the vehicle model. */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp into [0, 1]; non-finite inputs collapse to 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a > Math.PI) a -= twoPi;
  else if (a <= -Math.PI) a += twoPi;
  return a;
}

/**
 * Frame-rate independent exponential smoothing: the fraction of the gap closed
 * in `dt` seconds for a given per-second `rate`. Used for steering/velocity
 * damping so the result does not depend on how the time was chunked.
 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-Math.max(rate, 0) * Math.max(dt, 0));
}
