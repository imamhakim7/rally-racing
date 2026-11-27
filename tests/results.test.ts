import { describe, expect, it } from "vitest";
import {
  formatDelta,
  formatSpeed,
  formatTime,
  playerPosition,
  positionForTime,
  rankStandings,
  referenceTimeAt,
  splitDelta,
  sumSplits,
} from "../src/race/results";
import type { ReferenceSplit, Split } from "../src/race/types";

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

describe("reference pace helpers", () => {
  const reference: ReferenceSplit[] = [
    { checkpointId: "cp-1", time: 12 },
    { checkpointId: "finish", time: 44 },
  ];

  it("reads a target time by gate id, null when unset", () => {
    expect(referenceTimeAt(reference, "cp-1")).toBe(12);
    expect(referenceTimeAt(reference, "cp-2")).toBeNull();
    expect(referenceTimeAt(undefined, "cp-1")).toBeNull();
  });

  it("splits delta = actual cumulative minus reference cumulative", () => {
    expect(splitDelta({ checkpointId: "cp-1", index: 0, delta: 10, time: 10 }, reference)).toBe(-2);
    expect(splitDelta({ checkpointId: "cp-1", index: 0, delta: 14, time: 14 }, reference)).toBe(2);
    expect(splitDelta({ checkpointId: "cp-1", index: 0, delta: 12, time: 12 }, reference)).toBe(0);
  });

  it("returns null when the gate has no reference", () => {
    expect(splitDelta({ checkpointId: "cp-9", index: 0, delta: 1, time: 1 }, reference)).toBeNull();
  });

  it("positionForTime shares places like rankStandings", () => {
    const opponents = [
      { name: "A", time: 40 },
      { name: "B", time: 42.5 },
      { name: "C", time: 50 },
    ];
    expect(positionForTime(39, opponents)).toBe(1);
    expect(positionForTime(42.5, opponents)).toBe(2); // tie with B
    expect(positionForTime(45, opponents)).toBe(3);
    expect(positionForTime(99, opponents)).toBe(4);
  });
});

describe("formatSpeed / formatDelta", () => {
  it("rounds speed and clamps bad values", () => {
    expect(formatSpeed(127.6)).toBe("128");
    expect(formatSpeed(-4)).toBe("0");
    expect(formatSpeed(Number.NaN)).toBe("0");
  });

  it("formats a signed delta to 3dp; zero is unsigned", () => {
    expect(formatDelta(-0.482)).toBe("-0.482");
    expect(formatDelta(1.204)).toBe("+1.204");
    expect(formatDelta(0)).toBe("0.000");
    expect(formatDelta(Number.NaN)).toBe("0.000");
  });
});
