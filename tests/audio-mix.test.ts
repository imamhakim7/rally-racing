import { describe, expect, it } from "vitest";
import {
  AudioMixer,
  computeAudioMix,
  silentMix,
  SURFACE_AUDIO,
  type CarAudioState,
} from "../src/audio/mix-model";
import { SURFACE_IDS, type SurfaceId } from "../src/physics/surface";

function car(overrides: Partial<CarAudioState> = {}): CarAudioState {
  return {
    rpm01: 0.5,
    load01: 0.5,
    speed01: 0.5,
    slip01: 0.5,
    surface: "tarmac",
    impact01: 0,
    ...overrides,
  };
}

const DRY = { wind01: 0, rain01: 0 };

describe("computeAudioMix — AC1 engine tracks rpm and load", () => {
  it("raises engine pitch as rpm rises", () => {
    const low = computeAudioMix(car({ rpm01: 0.1 }), DRY);
    const high = computeAudioMix(car({ rpm01: 0.9 }), DRY);
    expect(high.engine.pitch).toBeGreaterThan(low.engine.pitch);
  });

  it("raises engine gain as load rises (rpm held constant)", () => {
    const coast = computeAudioMix(car({ load01: 0.05 }), DRY);
    const wot = computeAudioMix(car({ load01: 1 }), DRY);
    expect(wot.engine.gain).toBeGreaterThan(coast.engine.gain);
  });

  it("keeps a non-zero idle gain (engine never fully silent under load 0)", () => {
    const idle = computeAudioMix(car({ rpm01: 0.1, load01: 0 }), DRY);
    expect(idle.engine.gain).toBeGreaterThan(0);
  });
});

describe("computeAudioMix — AC2 surface timbre changes measurably", () => {
  it("gives every surface a distinct gain and pitch at identical slip", () => {
    const perSurface = SURFACE_IDS.map((surface) =>
      computeAudioMix(car({ surface, slip01: 0.8, speed01: 0.6 }), DRY),
    );
    const gains = perSurface.map((m) => m.tyres.gain);
    const pitches = perSurface.map((m) => m.tyres.pitch);
    expect(new Set(gains).size).toBe(SURFACE_IDS.length);
    expect(new Set(pitches).size).toBe(SURFACE_IDS.length);
  });

  it("changes tyre gain and pitch between tarmac and gravel", () => {
    const tarmac = computeAudioMix(car({ surface: "tarmac", slip01: 0.7 }), DRY);
    const gravel = computeAudioMix(car({ surface: "gravel", slip01: 0.7 }), DRY);
    expect(gravel.tyres.gain).not.toBeCloseTo(tarmac.tyres.gain);
    expect(gravel.tyres.pitch).not.toBeCloseTo(tarmac.tyres.pitch);
    expect(gravel.tyres.gain).toBeGreaterThan(tarmac.tyres.gain);
  });

  it("silences the tyre bus with no slip and no speed", () => {
    const rolling = computeAudioMix(car({ slip01: 0, speed01: 0 }), DRY);
    expect(rolling.tyres.gain).toBe(0);
  });

  it("exposes the surface on the resolved mix", () => {
    for (const surface of SURFACE_IDS) {
      expect(computeAudioMix(car({ surface }), DRY).surface).toBe(surface);
    }
  });
});

describe("computeAudioMix — AC3 rain and wind layer with the weather preset", () => {
  it("raises the wind layer as wind01 rises", () => {
    const calm = computeAudioMix(car({ speed01: 0.5 }), { wind01: 0, rain01: 0 });
    const windy = computeAudioMix(car({ speed01: 0.5 }), { wind01: 1, rain01: 0 });
    expect(windy.ambience.wind).toBeGreaterThan(calm.ambience.wind);
  });

  it("raises the rain layer as rain01 rises and keeps it independent of wind", () => {
    const dry = computeAudioMix(car({ speed01: 0.5 }), { wind01: 0, rain01: 0 });
    const wet = computeAudioMix(car({ speed01: 0.5 }), { wind01: 0, rain01: 0.8 });
    expect(wet.ambience.rain).toBeGreaterThan(dry.ambience.rain);
    expect(wet.ambience.wind).toBe(dry.ambience.wind);
  });

  it("grows the wind layer with speed", () => {
    const slow = computeAudioMix(car({ speed01: 0.05 }), { wind01: 1, rain01: 0 });
    const fast = computeAudioMix(car({ speed01: 1 }), { wind01: 1, rain01: 0 });
    expect(fast.ambience.wind).toBeGreaterThan(slow.ambience.wind);
  });
});

describe("computeAudioMix — invariants and edge cases", () => {
  it("is pure (identical inputs give a deeply equal mix)", () => {
    const a = computeAudioMix(car(), { wind01: 0.3, rain01: 0.2 });
    const b = computeAudioMix(car(), { wind01: 0.3, rain01: 0.2 });
    expect(a).toEqual(b);
  });

  it("clamps every gain into [0,1] and keeps pitch finite/positive", () => {
    for (const m of [silentMix(), computeAudioMix(car({ load01: 5, slip01: 5 }), { wind01: 5, rain01: 5 })]) {
      expect(m.engine.gain).toBeGreaterThanOrEqual(0);
      expect(m.engine.gain).toBeLessThanOrEqual(1);
      expect(m.tyres.gain).toBeGreaterThanOrEqual(0);
      expect(m.tyres.gain).toBeLessThanOrEqual(1);
      expect(m.ambience.wind).toBeLessThanOrEqual(1);
      expect(m.ambience.rain).toBeLessThanOrEqual(1);
      expect(m.impacts.gain).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.engine.pitch)).toBe(true);
      expect(m.engine.pitch).toBeGreaterThan(0);
    }
  });

  it("never throws and falls back to neutral on non-finite / missing input", () => {
    expect(() => computeAudioMix(null, null)).not.toThrow();
    const m = computeAudioMix(
      car({ rpm01: NaN, load01: Infinity, speed01: -3, slip01: NaN }),
      { wind01: NaN, rain01: Infinity },
    );
    expect(Number.isFinite(m.engine.pitch)).toBe(true);
    expect(m.engine.gain).toBeGreaterThanOrEqual(0);
    expect(m.tyres.gain).toBe(0);
  });

  it("uses a distinct timbre row per surface", () => {
    const rows = SURFACE_IDS.map((s: SurfaceId) => SURFACE_AUDIO[s]);
    expect(new Set(rows.map((r) => r.tyresGain)).size).toBe(SURFACE_IDS.length);
    expect(new Set(rows.map((r) => r.tyresPitch)).size).toBe(SURFACE_IDS.length);
  });
});

describe("AudioMixer — smoothing", () => {
  it("snaps to the target on the first step and reuses one object", () => {
    const mixer = new AudioMixer();
    const first = mixer.step(car({ rpm01: 1, load01: 1 }), { wind01: 1, rain01: 1 }, 1 / 60);
    const target = mixer.target(car({ rpm01: 1, load01: 1 }), { wind01: 1, rain01: 1 });
    expect(first.engine.gain).toBeCloseTo(target.engine.gain);
    const second = mixer.step(car({ rpm01: 0, load01: 0 }), DRY, 1 / 60);
    expect(second).toBe(first); // same object identity: no per-step allocation
  });

  it("eases toward a new target and reset() snaps back", () => {
    const mixer = new AudioMixer({ smoothing: 8 });
    mixer.step(car({ load01: 1, slip01: 1 }), DRY, 1);
    const loud = mixer.current.engine.gain;
    const eased = mixer.step(car({ load01: 0, slip01: 0 }), DRY, 1 / 60);
    expect(eased.engine.gain).toBeLessThan(loud);
    expect(eased.engine.gain).toBeGreaterThan(0);
    const reset = mixer.reset();
    expect(reset).toEqual(silentMix());
  });
});
