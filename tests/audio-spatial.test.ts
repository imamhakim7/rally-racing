import { describe, expect, it } from "vitest";
import {
  attenuationGain,
  chaseYaw,
  listenerFromCar,
  panForSource,
  planarDistance,
} from "../src/audio/spatial";

const listener = { x: 0, y: 0, z: 0, yaw: 0 }; // facing +z

describe("attenuationGain — AC4 3D attenuation", () => {
  it("returns full gain inside the reference distance", () => {
    expect(attenuationGain(0)).toBe(1);
    expect(attenuationGain(4)).toBe(1);
    expect(attenuationGain(8)).toBe(1);
  });

  it("is strictly decreasing beyond the reference distance", () => {
    const far = attenuationGain(200);
    const near = attenuationGain(30);
    const mid = attenuationGain(120);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it("reaches exactly zero at (and beyond) the max distance", () => {
    expect(attenuationGain(220)).toBe(0);
    expect(attenuationGain(1000)).toBe(0);
  });

  it("never returns non-finite values for malformed distances/options", () => {
    for (const d of [NaN, Infinity, -Infinity, -10]) {
      const g = attenuationGain(d);
      expect(Number.isFinite(g)).toBe(true);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
    const custom = attenuationGain(50, { refDistance: NaN, maxDistance: NaN, rolloff: NaN });
    expect(Number.isFinite(custom)).toBe(true);
  });
});

describe("panForSource — stereo placement", () => {
  it("puts a source on the right at hard right and left at hard left", () => {
    expect(panForSource({ x: 10, z: 0 }, listener)).toBeCloseTo(1);
    expect(panForSource({ x: -10, z: 0 }, listener)).toBeCloseTo(-1);
  });

  it("puts a source ahead dead centre and behind dead centre", () => {
    expect(panForSource({ x: 0, z: 10 }, listener)).toBeCloseTo(0);
    expect(panForSource({ x: 0, z: -10 }, listener)).toBeCloseTo(0);
  });

  it("rotates with the listener yaw", () => {
    const facingRight = { ...listener, yaw: Math.PI / 2 }; // forward +x, right -z
    expect(panForSource({ x: 10, z: 0 }, facingRight)).toBeCloseTo(0);
    expect(panForSource({ x: 0, z: -10 }, facingRight)).toBeCloseTo(1);
  });

  it("returns 0 for a source at the listener and stays in [-1,1]", () => {
    expect(panForSource({ x: 0, z: 0 }, listener)).toBe(0);
    for (const p of [{ x: 500, z: -300 }, { x: -1, z: 4 }]) {
      const pan = panForSource(p, listener);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    }
  });
});

describe("listenerFromCar — chase camera listener", () => {
  it("sits on the car when there is no camera", () => {
    expect(listenerFromCar({ x: 3, z: -4 })).toEqual({ x: 3, y: 0, z: -4, yaw: 0 });
  });

  it("takes the camera position and faces the car", () => {
    const cam = { x: 0, y: 5, z: -10 };
    const carPos = { x: 0, z: 0 };
    const state = listenerFromCar(carPos, cam);
    expect(state).toEqual({ x: 0, y: 5, z: -10, yaw: chaseYaw(cam, carPos) });
  });

  it("honours an explicit yaw", () => {
    const state = listenerFromCar({ x: 1, z: 1 }, { x: 0, z: 0 }, 1.2);
    expect(state.yaw).toBe(1.2);
  });
});

describe("planarDistance", () => {
  it("measures x/z (and y) separation", () => {
    expect(planarDistance({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(planarDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 })).toBe(2);
  });
});
