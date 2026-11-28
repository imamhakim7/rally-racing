/**
 * Difficulty tiers and bounded catch-up (#APEX-8).
 *
 * A data-driven layer over #APEX-7's `CpuDriver`. Each tier is a row in a lookup
 * table — never an `if (tier === …)` branch — so a new tier is a content edit.
 * A tier scales three human-legible axes:
 *
 *  - **skill**      — the feasible corner/straight target-speed multiplier.
 *  - **reaction**   — how tightly/early the driver tracks the line (steer gains
 *                     up, lookahead shorter).
 *  - **aggression** — how hard it presses a car ahead (overtake gain up, the
 *                     following gap down).
 *
 * Catch-up is a *bounded target-speed scalar*: `boundedCatchUp` never returns a
 * ratio outside the tier's `[1−maxSlow, 1+maxBoost]` band, and the effective skill
 * is always clamped by the tier's `skillCap`. It changes no position and no
 * velocity, so it can never teleport a car.
 *
 * Pure: no DOM, no `three.js`, no wall clock, no `Math.random`.
 */
import { clamp } from "../physics/util";
import { DEFAULT_DRIVER_TUNING, type DriverTuning } from "./driver";

/** The four selectable opponent tiers, weakest to strongest. */
export type DifficultyTier = "easy" | "normal" | "hard" | "rally-legend";

/** Tier order, weakest first — the canonical ordering the tests assert. */
export const DIFFICULTY_TIERS: readonly DifficultyTier[] = [
  "easy",
  "normal",
  "hard",
  "rally-legend",
];

/**
 * Skill of the deterministic "competent human" reference used to grade tier
 * balance: `1` follows the racing line's feasible speed exactly.
 */
export const COMPETENT_HUMAN_SKILL = 1;

/**
 * Documented upper bound on the player↔pack speed-delta telemetry (`m/s`). The
 * fastest feasible speed is `vMax` (40 m/s), so a delta can never approach this;
 * measured tier races stay under ~19 m/s. Exceeding it means catch-up is creating
 * an unnatural speed difference.
 */
export const MAX_SPEED_DELTA = 25;

/**
 * Documented upper bound on a car's per-step ground displacement (metres): a car
 * at `vMax` (40 m/s) moves 0.67 m per 1/60 s step, so anything above 1 m is a
 * teleport. Catch-up only scales a target speed, so it can never trip this.
 */
export const MAX_STEP_DISPLACEMENT = 1.0;

/** Bounds on the rubber-band. `gap > 0` = the car is behind the reference. */
export interface CatchUpConfig {
  /** Maximum target-speed boost when behind, as a fraction (`0.06` = +6 %). */
  maxBoost: number;
  /** Maximum target-speed penalty when ahead, as a fraction. */
  maxSlow: number;
  /** Gap (metres) at which the boost/slow saturates. */
  fullGapRange: number;
  /** Absolute ceiling on the effective skill for this tier. */
  skillCap: number;
}

/** One difficulty tier's tuning. */
export interface DifficultyTuning {
  tier: DifficultyTier;
  /** Human-readable name. */
  label: string;
  /** Target-speed multiplier applied to the racing line's feasible speed. */
  skill: number;
  /** Responsiveness scalar (>1 tracks the line tighter/earlier). */
  reaction: number;
  /** Press-on scalar (>1 overtakes harder, follows closer). */
  aggression: number;
  /** Numeric `DriverTuning` overrides derived from `reaction`/`aggression`. */
  driverTuning: Partial<DriverTuning>;
  /** The tier's bounded catch-up band. */
  catchUp: CatchUpConfig;
}

/**
 * The tier table. `skillCap < skill·(1+maxBoost)` for every row, so a saturated
 * boost is always clamped by the cap (the cap is load-bearing, not decorative).
 */
const TIER_CONFIG: Record<
  DifficultyTier,
  Omit<DifficultyTuning, "driverTuning">
> = {
  easy: {
    tier: "easy",
    label: "Easy",
    skill: 0.8,
    reaction: 0.9,
    aggression: 0.7,
    catchUp: { maxBoost: 0.04, maxSlow: 0.02, fullGapRange: 60, skillCap: 0.83 },
  },
  normal: {
    tier: "normal",
    label: "Normal",
    skill: 0.92,
    reaction: 1.0,
    aggression: 1.0,
    catchUp: { maxBoost: 0.04, maxSlow: 0.02, fullGapRange: 50, skillCap: 0.955 },
  },
  hard: {
    tier: "hard",
    label: "Hard",
    skill: 1.02,
    reaction: 1.04,
    aggression: 1.1,
    catchUp: { maxBoost: 0.03, maxSlow: 0.015, fullGapRange: 45, skillCap: 1.05 },
  },
  "rally-legend": {
    tier: "rally-legend",
    label: "Rally Legend",
    skill: 1.06,
    reaction: 1.08,
    aggression: 1.15,
    catchUp: { maxBoost: 0.03, maxSlow: 0.015, fullGapRange: 35, skillCap: 1.09 },
  },
};

/** Type guard for an untrusted tier value (URL query, persisted settings). */
export function isDifficultyTier(value: unknown): value is DifficultyTier {
  return typeof value === "string" && (DIFFICULTY_TIERS as readonly string[]).includes(value);
}

/** Coerce an arbitrary value into a tier; unknown/missing ⇒ `"normal"`. */
export function coerceDifficultyTier(value: unknown): DifficultyTier {
  return isDifficultyTier(value) ? value : "normal";
}

/**
 * Scale #APEX-7's default driver tuning by a tier's reaction/aggression scalars.
 * Reaction tightens line tracking (`kHeading`/`kCross`); aggression presses the
 * car ahead harder (`overtakeGain` up, following gap down). Both are deliberately
 * mild so `skill` — the target-speed multiplier — stays the dominant, monotone
 * pace axis. Edge containment is enforced structurally by the race simulator
 * (#APEX-8), not by over-slowing the tier here. Pure and data-driven.
 */
export function scaleDriverTuning(reaction: number, aggression: number): Partial<DriverTuning> {
  const r = Number.isFinite(reaction) && reaction > 0 ? reaction : 1;
  const a = Number.isFinite(aggression) && aggression > 0 ? aggression : 1;
  return {
    kHeading: DEFAULT_DRIVER_TUNING.kHeading * r,
    kCross: DEFAULT_DRIVER_TUNING.kCross * r,
    overtakeGain: DEFAULT_DRIVER_TUNING.overtakeGain * a,
    minGap: DEFAULT_DRIVER_TUNING.minGap / a,
  };
}

/** Resolve a tier to its full tuning. Unknown/untrusted input falls back to `normal`. */
export function difficultyTuning(tier: DifficultyTier | string | undefined | null): DifficultyTuning {
  const resolved = coerceDifficultyTier(tier);
  const cfg = TIER_CONFIG[resolved];
  return { ...cfg, driverTuning: scaleDriverTuning(cfg.reaction, cfg.aggression) };
}

/** The outcome of a bounded catch-up evaluation. */
export interface CatchUpState {
  /** Nominal rubber-band multiplier before the skill cap (`1` = no change). */
  factor: number;
  /** Effective skill after the tier cap. */
  effectiveSkill: number;
  /** Applied multiplier `effectiveSkill / baseSkill` (≤ `factor`). */
  ratio: number;
  /** `true` when the skill cap clamped the boost. */
  capped: boolean;
}

const EPS = 1e-9;

/**
 * Bound the rubber-band for one car this step.
 *
 * @param baseSkill the car's nominal skill (its tier's `skill`)
 * @param gapMetres reference distance − car distance; `> 0` = behind, `< 0` = ahead
 * @param cfg the tier's catch-up band
 *
 * Guarantees `ratio ∈ [1−maxSlow, 1+maxBoost]` and `effectiveSkill ≤ skillCap` for
 * every input. A non-finite `gapMetres` (or `baseSkill`) yields no change.
 */
export function boundedCatchUp(
  baseSkill: number,
  gapMetres: number,
  cfg: CatchUpConfig,
): CatchUpState {
  // A non-finite base skill has no meaningful ratio: leave the car unassisted.
  if (!Number.isFinite(baseSkill) || baseSkill <= 0) {
    return { factor: 1, effectiveSkill: 1, ratio: 1, capped: false };
  }
  const skill = baseSkill;
  const range = cfg.fullGapRange > 0 ? cfg.fullGapRange : 1;
  const maxBoost = Math.max(0, cfg.maxBoost);
  const maxSlow = Math.max(0, cfg.maxSlow);
  const cap = Number.isFinite(cfg.skillCap) ? cfg.skillCap : Infinity;

  const u = Number.isFinite(gapMetres) ? clamp(gapMetres / range, -1, 1) : 0;
  const factor = 1 + (u >= 0 ? maxBoost : maxSlow) * u;
  const uncapped = skill * factor;
  const effectiveSkill = Math.min(uncapped, cap);
  const ratio = effectiveSkill / skill;
  return {
    factor,
    effectiveSkill,
    ratio,
    capped: uncapped > cap + EPS,
  };
}
