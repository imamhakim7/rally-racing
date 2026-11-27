import type { OpponentDef, ReferenceSplit, Split, Standing } from "./types";

/** Sum of the per-segment deltas — the raw (penalty-free) run time. */
export function sumSplits(splits: Split[]): number {
  let total = 0;
  for (const split of splits) total += split.delta;
  return total;
}

/**
 * Rank the player's total against fixed opponent times.
 *
 * Standard competition ranking: equal times share a position and the next
 * distinct time skips the shared places (1,2,2,4). The player is always
 * present, so an empty opponent list yields position 1.
 */
export function rankStandings(
  playerName: string,
  playerTime: number,
  opponents: readonly OpponentDef[],
): Standing[] {
  const rows = [
    { name: playerName, time: playerTime, isPlayer: true },
    ...opponents.map((opponent) => ({ name: opponent.name, time: opponent.time, isPlayer: false })),
  ].sort((a, b) => a.time - b.time);

  const standings: Standing[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  let position = 0;
  rows.forEach((row, i) => {
    if (row.time !== previousTime) position = i + 1;
    previousTime = row.time;
    standings.push({ ...row, position });
  });
  return standings;
}

/** 1-based position of the player, or `null` when absent. */
export function playerPosition(standings: Standing[]): number | null {
  return standings.find((row) => row.isPlayer)?.position ?? null;
}

/**
 * 1-based position a given total time would earn against opponents, using the
 * same shared-place rule as `rankStandings` (equal times tie). The player is
 * just a time here, so this is safe to call with a *projected* finish time.
 */
export function positionForTime(time: number, opponents: readonly OpponentDef[]): number {
  let position = 1;
  for (const opponent of opponents) {
    if (opponent.time < time) position += 1;
  }
  return position;
}

/** The target cumulative time at `checkpointId`, or `null` when unset. */
export function referenceTimeAt(
  reference: readonly ReferenceSplit[] | undefined,
  checkpointId: string,
): number | null {
  if (!reference) return null;
  const match = reference.find((entry) => entry.checkpointId === checkpointId);
  return match ? match.time : null;
}

/**
 * Split delta in seconds: the actual cumulative time minus the reference
 * cumulative time at the same gate. Negative = ahead of pace, positive =
 * behind, `null` when no reference exists for the gate.
 */
export function splitDelta(
  split: Split,
  reference: readonly ReferenceSplit[] | undefined,
): number | null {
  const target = referenceTimeAt(reference, split.checkpointId);
  return target === null ? null : split.time - target;
}

/** Speed for the HUD: rounded km/h, clamped to finite/non-negative. */
export function formatSpeed(kmh: number): string {
  const safe = Number.isFinite(kmh) && kmh > 0 ? kmh : 0;
  return String(Math.round(safe));
}

/**
 * Format a signed split delta as `+1.234` / `-0.482` (seconds to 3 dp). Uses a
 * plain ASCII sign so the value is unambiguous for screen readers and copy
 * (the ahead/behind colour + glyph are added by the view model). A delta that
 * rounds to zero is rendered without a sign.
 */
export function formatDelta(seconds: number): string {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  const ms = Math.round(safe * 1000);
  if (ms === 0) return "0.000";
  const sign = ms > 0 ? "+" : "-";
  const abs = Math.abs(ms);
  const whole = Math.floor(abs / 1000);
  const millis = abs % 1000;
  return `${sign}${whole}.${String(millis).padStart(3, "0")}`;
}

/**
 * Format seconds as `M:SS.mmm` (e.g. `1:07.482`). Negative/non-finite values
 * are clamped to 0 so a bad value can never render as `-0:0-1`.
 */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.round(safe * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
