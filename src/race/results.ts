import type { OpponentDef, Split, Standing } from "./types";

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
