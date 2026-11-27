import { describe, expect, it } from "vitest";
import {
  formatTime,
  playerPosition,
  rankStandings,
  sumSplits,
} from "../src/race/results";
import type { Split } from "../src/race/types";

function split(delta: number, time: number, index: number): Split {
  return { checkpointId: `cp-${index}`, index, delta, time };
}

describe("sumSplits", () => {
  it("adds every split delta", () => {
    expect(sumSplits([split(1, 1, 0), split(1.5, 2.5, 1), split(0.5, 3, 2)])).toBeCloseTo(3, 10);
  });

  it("is zero for no splits", () => {
    expect(sumSplits([])).toBe(0);
  });
});

describe("rankStandings", () => {
  it("orders the player and opponents by time", () => {
    const standings = rankStandings("You", 45, [
      { name: "Vega", time: 40 },
      { name: "Rustad", time: 50 },
    ]);

    expect(standings.map((s) => s.name)).toEqual(["Vega", "You", "Rustad"]);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(playerPosition(standings)).toBe(2);
  });

  it("shares a position on a tie and skips the next place", () => {
    const standings = rankStandings("You", 42.5, [
      { name: "A", time: 40 },
      { name: "B", time: 42.5 },
      { name: "C", time: 50 },
    ]);

    expect(standings.map((s) => s.position)).toEqual([1, 2, 2, 4]);
  });

  it("wins against an empty field", () => {
    const standings = rankStandings("You", 99, []);
    expect(standings).toHaveLength(1);
    expect(playerPosition(standings)).toBe(1);
  });
});

describe("formatTime", () => {
  it("formats M:SS.mmm", () => {
    expect(formatTime(0)).toBe("0:00.000");
    expect(formatTime(5.5)).toBe("0:05.500");
    expect(formatTime(67.482)).toBe("1:07.482");
  });

  it("clamps negative and non-finite input to zero", () => {
    expect(formatTime(-3)).toBe("0:00.000");
    expect(formatTime(Number.NaN)).toBe("0:00.000");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00.000");
  });
});
