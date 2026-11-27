/**
 * Simplified Pacejka "magic formula" tyre curve.
 *
 * The full Pacejka model is `F = D·sin(C·atan(B·s − E·(B·s − atan(B·s))))`.
 * For an arcade rally game the shape factor `E` adds tuning surface with little
 * payoff, so we use the common simplification (`E = 0`):
 *
 *     F(s) = peak · sin(shape · atan(stiffness · s))
 *
 * `F` is odd around `s = 0` (force opposes slip), bounded by `±peak` (the tyre
 * saturates once it slides) and smooth everywhere, which keeps the fixed-step
 * integration stable. `stiffness` (B) sets how quickly force builds with slip;
 * `shape` (C) sets where the peak sits — with `shape = 1.6` the curve peaks near
 * `s = tan(π / (2·shape)) / stiffness ≈ 1.45 / stiffness`.
 */

export interface PacejkaCurve {
  /** Peak force at saturation (N). Always applied with the sign of the output. */
  peak: number;
  /** Cornering/traction stiffness (B). Larger = force builds faster with slip. */
  stiffness: number;
  /** Shape factor (C); defaults to 1.6 (a realistic tyre peak). */
  shape?: number;
}

export const DEFAULT_TYRE_SHAPE = 1.6;

/**
 * Evaluate the simplified magic formula at `slip` (radians for a slip angle, or
 * a normalised longitudinal slip ratio). Returns a force in newtons with the
 * same sign as `slip` — callers negate to obtain the opposing force.
 */
export function pacejka(slip: number, curve: PacejkaCurve): number {
  if (!Number.isFinite(slip)) return 0;
  const shape = curve.shape ?? DEFAULT_TYRE_SHAPE;
  return curve.peak * Math.sin(shape * Math.atan(curve.stiffness * slip));
}

/**
 * The slip at which `pacejka` reaches its peak (the transition from grip to
 * slide). Useful for tests and for tuning the drift threshold.
 */
export function pacejkaPeakSlip(curve: PacejkaCurve): number {
  const shape = curve.shape ?? DEFAULT_TYRE_SHAPE;
  return Math.tan(Math.PI / (2 * shape)) / Math.max(curve.stiffness, 1e-9);
}
