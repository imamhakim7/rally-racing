/**
 * Seeded pseudo-random number generator.
 *
 * The CPU drivers jitter their skill a little so a field is not four identical
 * cars, but the whole race must be **deterministic for a given seed**. A tiny
 * `mulberry32` stream gives us that: same seed ⇒ same sequence, no `Math.random`,
 * no clock. #APEX-8 will use the same seed to reproduce difficulty tiers.
 */

/** Create a deterministic 32-bit PRNG from a numeric seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
