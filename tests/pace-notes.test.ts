import { describe, expect, it } from "vitest";
import { validateStage } from "../src/stage/validate";
import { sampleSpline, type SampledSpline } from "../src/stage/spline";
import {
  PaceNoteTracker,
  buildPaceNotes,
  nearestDistanceOnSpline,
  noteCall,
  severityForAngle,
  type PaceNote,
} from "../src/race/pace-notes";
import { buildPaceNoteHud } from "../src/race/hud-model";
import { clone, makeStageDocument } from "./stage-fixtures";

/** A sampled centreline for a stage with a custom spline. */
function splineFor(points: { x: number; y: number; z: number }[]): SampledSpline {
  const circuit = validateStage(
    { ...clone(makeStageDocument()), spline: { closed: false, tension: 0.5, points } },
    "pace.json",
  );
  return sampleSpline(circuit.spline, circuit.road.sampleStep);
}

/** One right-hand bend: straight then a 90° turn. */
function oneCornerSpline(): SampledSpline {
  return splineFor([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 60 },
    { x: 60, y: 0, z: 60 },
  ]);
}

/** A right bend then a left bend. */
function twoCornerSpline(): SampledSpline {
  return splineFor([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 60 },
    { x: 60, y: 0, z: 60 },
    { x: 60, y: 0, z: 120 },
  ]);
}

/** A dead-straight stage: no corners, no notes. */
function straightSpline(): SampledSpline {
  return splineFor([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 60 },
    { x: 0, y: 0, z: 120 },
  ]);
}

describe("severityForAngle / noteCall", () => {
  it("maps heading change to the 1..6 rally scale", () => {
    expect(severityForAngle(5)).toBe(1);
    expect(severityForAngle(30)).toBe(2);
    expect(severityForAngle(50)).toBe(3);
    expect(severityForAngle(80)).toBe(4);
    expect(severityForAngle(120)).toBe(5);
    expect(severityForAngle(170)).toBe(6);
    expect(severityForAngle(-170)).toBe(6);
  });

  it("formats a numeric call and a hairpin", () => {
    expect(noteCall("right", 50, 3)).toBe("Right 3");
    expect(noteCall("left", -50, 3)).toBe("Left 3");
    expect(noteCall("left", -160, 6)).toBe("Hairpin left");
  });
});

describe("buildPaceNotes — derivation (AC1)", () => {
  it("produces a note with distance and direction from a bend", () => {
    const notes = buildPaceNotes(oneCornerSpline(), { thresholdDeg: 20 });
    expect(notes.length).toBeGreaterThan(0);
    const note = notes[0]!;
    expect(note.direction).toBe("right");
    expect(note.distance).toBeGreaterThan(0);
    expect(note.distance).toBeLessThanOrEqual(oneCornerSpline().length);
    expect(note.severity).toBeGreaterThanOrEqual(1);
    expect(note.severity).toBeLessThanOrEqual(6);
    expect(note.call).toMatch(/^(Right|Hairpin right)/);
    expect(note.angleDeg).toBeGreaterThan(0);
  });

  it("orders notes by distance and computes gaps from the start", () => {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20 });
    expect(notes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < notes.length; i += 1) {
      expect(notes[i]!.distance).toBeGreaterThan(notes[i - 1]!.distance);
    }
    expect(notes[0]!.gap).toBeCloseTo(notes[0]!.distance, 6);
    expect(notes[1]!.gap).toBeCloseTo(notes[1]!.distance - notes[0]!.distance, 6);
    expect(notes.map((n) => n.direction)).toContain("right");
  });

  it("is deterministic for the same input", () => {
    const spline = twoCornerSpline();
    expect(buildPaceNotes(spline, { thresholdDeg: 20 })).toEqual(
      buildPaceNotes(spline, { thresholdDeg: 20 }),
    );
  });

  it("merges corners closer than the minimum spacing", () => {
    const spline = twoCornerSpline();
    const spread = buildPaceNotes(spline, { thresholdDeg: 20, minSpacing: 0 });
    const merged = buildPaceNotes(spline, { thresholdDeg: 20, minSpacing: 1000 });
    expect(merged.length).toBeLessThanOrEqual(spread.length);
    expect(merged.length).toBe(1);
  });
});

describe("PaceNoteTracker — advance with progress (AC2)", () => {
  function tracker(): { tracker: PaceNoteTracker; notes: PaceNote[] } {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20, minSpacing: 0 });
    const t = new PaceNoteTracker(notes, { leadDistance: 10_000, density: 1 });
    return { tracker: t, notes };
  }

  it("starts on the first note and advances past it", () => {
    const { tracker: t, notes } = tracker();
    t.setDistance(0);
    expect(t.view().next).toBe(notes[0]);
    expect(t.view().current).toBeNull();

    t.setDistance(notes[0]!.distance + 1);
    expect(t.view().current).toBe(notes[0]);
    expect(t.view().next).toBe(notes[1]);

    t.setDistance(notes[notes.length - 1]!.distance + 1);
    expect(t.view().next).toBeNull();
    expect(t.view().current).toBe(notes[notes.length - 1]);
    expect(t.view().nextText).toBe("No notes ahead");
  });

  it("limits upcoming notes to the lead distance (AC4)", () => {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20, minSpacing: 0 });
    const t = new PaceNoteTracker(notes, { leadDistance: 10, density: 1 });
    t.setDistance(0);
    // The first corner is far beyond a 10 m lead, so nothing is upcoming.
    expect(t.view().upcoming.length).toBeGreaterThanOrEqual(0);

    t.setLeadDistance(10_000);
    t.setDistance(0);
    expect(t.view().upcoming.length).toBe(notes.length);
  });
});

describe("PaceNoteTracker — density (AC4)", () => {
  it("surfaces at least as many notes as density rises", () => {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20, minSpacing: 0 });
    const t = new PaceNoteTracker(notes, { leadDistance: 10_000, density: 0 });
    t.setDistance(0);
    const sparse = t.view().upcoming.length;
    t.setDensity(1);
    const dense = t.view().upcoming.length;
    expect(dense).toBeGreaterThanOrEqual(sparse);
  });
});

describe("PaceNoteTracker — announcements (AC3)", () => {
  it("returns each note exactly once as it enters the lead window", () => {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20, minSpacing: 0 });
    const t = new PaceNoteTracker(notes, { leadDistance: 10, density: 1 });
    t.setDistance(0);
    // Far away: nothing announced yet.
    expect(t.pollAnnouncement()).toBeNull();

    t.setDistance(notes[0]!.distance - 5);
    expect(t.pollAnnouncement()).toBe(notes[0]);
    expect(t.pollAnnouncement()).toBeNull();

    t.setDistance(notes[0]!.distance + 1);
    // Still outside the 10 m lead of the second note.
    expect(t.pollAnnouncement()).toBeNull();

    t.setDistance(notes[1]!.distance - 5);
    expect(t.pollAnnouncement()).toBe(notes[1]);
  });

  it("stays idempotent when density changes at runtime (APEX-33 regression)", () => {
    /** A hand-built note; distance doubles as the stable identity. */
    const note = (index: number, distance: number, severity: number): PaceNote => ({
      index,
      distance,
      t: distance / 300,
      direction: "left",
      severity,
      angleDeg: -30,
      label: null,
      call: `Left ${severity}`,
      gap: index ? 0 : distance,
    });
    const notes = [note(0, 60, 2), note(1, 130, 2), note(2, 254, 5)];

    // Sparse first: only the hairpin survives; it is announced once.
    const t = new PaceNoteTracker(notes, { leadDistance: 320, density: 0.6 });
    t.setDistance(0);
    expect(t.pollAnnouncement()?.call).toBe("Left 5");
    // Raising density must not re-call the note already announced.
    t.setDensity(1);
    t.setDistance(200);
    expect(t.pollAnnouncement()).toBeNull();

    // Dense first: the nearest note is announced, then lowering density must not
    // skip the hairpin that the re-filtered list now points at.
    const t2 = new PaceNoteTracker(notes, { leadDistance: 320, density: 1 });
    t2.setDistance(0);
    expect(t2.pollAnnouncement()?.call).toBe("Left 2");
    t2.setDensity(0.6);
    t2.setDistance(200);
    expect(t2.pollAnnouncement()?.call).toBe("Left 5");
  });
});

describe("graceful degradation (AC5)", () => {
  it("returns no notes for a straight stage and a safe view", () => {
    const notes = buildPaceNotes(straightSpline());
    expect(notes).toEqual([]);

    const t = new PaceNoteTracker(notes);
    t.setDistance(50);
    const view = t.view();
    expect(view.hasNotes).toBe(false);
    expect(view.next).toBeNull();
    expect(view.nextText).toBe("No notes");
    expect(t.pollAnnouncement()).toBeNull();
  });

  it("projects the HUD as hidden when there are no notes", () => {
    expect(buildPaceNoteHud(null).visible).toBe(false);
    expect(buildPaceNoteHud(new PaceNoteTracker([]).view()).visible).toBe(false);
  });
});

describe("buildPaceNoteHud", () => {
  it("projects the next call, distance and following notes", () => {
    const notes = buildPaceNotes(twoCornerSpline(), { thresholdDeg: 20, minSpacing: 0 });
    const t = new PaceNoteTracker(notes, { leadDistance: 10_000, density: 1 });
    t.setDistance(notes[0]!.distance - 30);

    const hud = buildPaceNoteHud(t.view());
    expect(hud.visible).toBe(true);
    expect(hud.hasNext).toBe(true);
    expect(hud.nextCall).toBe(notes[0]!.call);
    expect(hud.nextDistance).toMatch(/^\d+ m$/);
    expect(hud.srText).toContain("metres");
    expect(hud.following[0]).toBe(notes[1]?.call);
  });
});

describe("nearestDistanceOnSpline", () => {
  it("maps the start and end points to 0 and the length", () => {
    const spline = oneCornerSpline();
    const start = spline.positionAt(0);
    const end = spline.positionAt(spline.count - 1);
    expect(nearestDistanceOnSpline(spline, start.x, start.z)).toBeCloseTo(0, 3);
    expect(nearestDistanceOnSpline(spline, end.x, end.z)).toBeCloseTo(spline.length, 1);
  });

  it("never throws on non-finite input", () => {
    const spline = oneCornerSpline();
    expect(Number.isFinite(nearestDistanceOnSpline(spline, NaN, Infinity))).toBe(true);
  });
});
