/**
 * Shared stage fixtures for the unit tests.
 *
 * A tiny valid circuit (a straight-ish 3-point spline, two checkpoints, three
 * surface zones) plus a deep clone helper so each test can corrupt exactly one
 * field and assert the validator names it.
 */
export function makeStageDocument(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "test-stage",
    name: "Test Stage",
    biome: "forest",
    difficulty: 3,
    start: { position: [0, 0, 0], headingDeg: 0 },
    finish: { t: 1, gate: { width: 10, height: 6 } },
    spline: {
      closed: false,
      tension: 0.5,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 60 },
        { x: 40, y: 0, z: 90 },
      ],
    },
    road: { width: 8, sampleStep: 2, surface: "gravel", bankingDeg: 0 },
    checkpoints: [
      { id: "cp-1", name: "One", t: 0.3, width: 9, height: 5 },
      { id: "cp-2", name: "Two", t: 0.6, width: 9, height: 5 },
    ],
    surfaces: [
      { id: "sz-a", surface: "tarmac", from: 0, to: 0.3, grip: 1 },
      { id: "sz-b", surface: "gravel", from: 0.3, to: 0.8, grip: 0.7 },
      { id: "sz-c", surface: "dirt", from: 0.8, to: 1, grip: 0.6 },
    ],
    minimap: { color: "#e8c547", path: "auto" },
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
