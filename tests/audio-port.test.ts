import { describe, expect, it } from "vitest";
import {
  createNullAudioPort,
  createWebAudioPort,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioContextSource,
  type AudioListenerLike,
  type AudioNodeLike,
  type AudioParamLike,
  type GainNodeLike,
  type PannerNodeLike,
} from "../src/audio/graph";
import { computeAudioMix } from "../src/audio/mix-model";

class FakeParam implements AudioParamLike {
  value = 1;
}

class FakeNode implements AudioNodeLike {
  connect(): unknown {
    return undefined;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam();
}

class FakePanner extends FakeNode implements PannerNodeLike {
  panningModel = "";
  distanceModel = "";
  refDistance = 0;
  maxDistance = 0;
  rolloffFactor = 0;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  setPosition(x: number, y: number, z: number): void {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }
}

class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  playbackRate = new FakeParam();
  starts: number[] = [];
  stops = 0;
  start(when = 0): void {
    this.starts.push(when);
  }
  stop(): void {
    this.stops += 1;
  }
}

class FakeListener implements AudioListenerLike {
  position: [number, number, number] = [0, 0, 0];
  orientation: [number, number, number, number, number, number] = [0, 0, 0, 0, 1, 0];
  setPosition(x: number, y: number, z: number): void {
    this.position = [x, y, z];
  }
  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.orientation = [fx, fy, fz, ux, uy, uz];
  }
}

class FakeContext implements AudioContextLike {
  state = "suspended";
  currentTime = 0;
  destination: AudioNodeLike = new FakeNode();
  listener = new FakeListener();
  resumeCalls = 0;
  closeCalls = 0;
  createdGains: FakeGain[] = [];
  createdSources: FakeSource[] = [];
  createdPanners: FakePanner[] = [];
  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.createdGains.push(gain);
    return gain;
  }
  createPanner(): PannerNodeLike {
    const panner = new FakePanner();
    this.createdPanners.push(panner);
    return panner;
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeSource();
    this.createdSources.push(source);
    return source;
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

const BUFFER: AudioBufferLike = { duration: 1 };

function assets(): Record<string, AudioBufferLike> {
  return { engine: BUFFER, tyres: BUFFER, wind: BUFFER, rain: BUFFER, impact: BUFFER, opponent: BUFFER };
}

function sourceFor(ctx: FakeContext): AudioContextSource {
  // `new Ctor()` returns the object the constructor returns, so the port builds
  // the exact fake we hold a handle to.
  const Ctor = function () {
    return ctx;
  } as unknown as new () => AudioContextLike;
  return { AudioContext: Ctor };
}

describe("createWebAudioPort — availability and degradation", () => {
  it("returns the null port without an AudioContext constructor", () => {
    for (const source of [null, undefined, {}]) {
      const port = createWebAudioPort(source);
      expect(port.available).toBe(false);
      expect(port.unlocked).toBe(false);
      expect(() => port.unlock()).not.toThrow();
      expect(() => port.update(computeAudioMix(null, null), { x: 0, y: 0, z: 0, yaw: 0 })).not.toThrow();
      expect(port.stats().available).toBe(false);
    }
  });

  it("exposes a safe no-op via createNullAudioPort", () => {
    const port = createNullAudioPort();
    expect(port.available).toBe(false);
    expect(port.stats()).toMatchObject({ available: false, buses: 0, activeVoices: 0 });
    expect(() => port.dispose()).not.toThrow();
  });

  it("falls back to the null port when the constructor throws", () => {
    const Ctor = function (): AudioContextLike {
      throw new Error("no audio device");
    } as unknown as new () => AudioContextLike;
    const port = createWebAudioPort({ AudioContext: Ctor });
    expect(port.available).toBe(false);
  });
});

describe("createWebAudioPort — graph and autoplay (AC5)", () => {
  it("builds one gain per bus and does not start sources before unlock", () => {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext }, { assets: assets() });
    expect(port.available).toBe(true);
    expect(port.unlocked).toBe(false);
    expect(ctx.createdGains).toHaveLength(10); // master + 5 buses + 4 opponent gains
    expect(ctx.createdSources).toHaveLength(0);
    expect(port.stats().buses).toBe(5);
  });

  it("unlock() resumes the context and starts the loops once (idempotent)", () => {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext }, { assets: assets() });
    port.unlock();
    port.unlock();
    expect(ctx.resumeCalls).toBe(1);
    // 5 bus loops + 4 opponent loops
    expect(ctx.createdSources).toHaveLength(9);
    for (const source of ctx.createdSources) {
      expect(source.loop).toBe(true);
      expect(source.starts).toHaveLength(1);
    }
    expect(port.unlocked).toBe(true);
  });

  it("does not create or start sources when no buffers are supplied", () => {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext });
    port.unlock();
    expect(ctx.createdSources).toHaveLength(0);
    expect(port.stats().activeVoices).toBe(0);
    expect(ctx.resumeCalls).toBe(1);
  });

  it("ignores update() before unlock", () => {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext }, { assets: assets() });
    port.update(computeAudioMix({ load01: 1 }, null), { x: 0, y: 0, z: 0, yaw: 0 });
    expect(port.stats().updates).toBe(0);
  });
});

describe("createWebAudioPort — applying the mix (AC1/AC2/AC3)", () => {
  function unlocked() {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext }, { assets: assets() });
    port.unlock();
    return { ctx, port, master: ctx.createdGains[0]!, engineBus: ctx.createdGains[1]!, tyreBus: ctx.createdGains[2]! };
  }

  it("writes bus gains and engine/tyre pitch from the mix", () => {
    const { ctx, port, engineBus, tyreBus } = unlocked();
    const mix = computeAudioMix({ rpm01: 0.8, load01: 0.7, surface: "gravel", slip01: 0.9 }, { wind01: 0.5, rain01: 0.4 });
    port.update(mix, { x: 1, y: 0, z: 2, yaw: 0.5 });
    expect(engineBus.gain.value).toBeCloseTo(mix.engine.gain);
    expect(tyreBus.gain.value).toBeCloseTo(mix.tyres.gain);
    expect(ctx.createdSources[0]!.playbackRate.value).toBeCloseTo(mix.engine.pitch);
    expect(ctx.createdSources[1]!.playbackRate.value).toBeCloseTo(mix.tyres.pitch);
    expect(ctx.listener.position).toEqual([1, 0, 2]);
  });

  it("applies master mute and volume", () => {
    const { port, master } = unlocked();
    port.setSettings({ muted: false, volume: 0.42 });
    expect(master.gain.value).toBeCloseTo(0.42);
    port.setSettings({ muted: true, volume: 0.42 });
    expect(master.gain.value).toBe(0);
  });

  it("attenuates a near opponent more than a far one (AC4)", () => {
    const { ctx, port } = unlocked();
    port.setOpponents([
      { x: 10, z: 0 },
      { x: 0, z: 200 },
    ]);
    port.update(computeAudioMix({ load01: 1, slip01: 1 }, null), { x: 0, y: 0, z: 0, yaw: 0 });
    const near = ctx.createdGains[6]!.gain.value;
    const far = ctx.createdGains[7]!.gain.value;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
    // panners are positioned for HRTF panning.
    expect(ctx.createdPanners[0]!.positionX.value).toBe(10);
    expect(ctx.createdPanners[1]!.positionZ.value).toBe(200);
  });

  it("keeps active voices bounded and counts updates (AC6 budget)", () => {
    const { ctx, port } = unlocked();
    port.setOpponents([{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }, { x: 4, z: 4 }]);
    port.update(computeAudioMix({ load01: 1 }, null), { x: 0, y: 0, z: 0, yaw: 0 });
    const stats = port.stats();
    expect(stats.updates).toBe(1);
    expect(stats.activeVoices).toBeLessThanOrEqual(5 + 4);
    expect(ctx.resumeCalls).toBe(1);
  });
});

describe("createWebAudioPort — dispose", () => {
  it("stops every source and makes update() a no-op", () => {
    const ctx = new FakeContext();
    const port = createWebAudioPort({ AudioContext: sourceFor(ctx).AudioContext }, { assets: assets() });
    port.unlock();
    port.dispose();
    expect(ctx.createdSources.every((s) => s.stops === 1)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
    expect(() => port.update(computeAudioMix({ load01: 1 }, null), { x: 0, y: 0, z: 0, yaw: 0 })).not.toThrow();
    expect(port.stats().updates).toBe(0);
  });
});
