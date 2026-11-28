/**
 * Telemetry port for the race HUD.
 *
 * The HUD only ever needs a tiny snapshot (`HudTelemetry`), so it consumes a
 * *port* rather than the vehicle directly. That keeps the overlay testable and
 * lets the source change without touching the HUD: today the default browser
 * source is a keyboard-driven `Vehicle` harness (the same "until the vehicle is
 * integrated in-world" pattern #APEX-3 used for gate crossings), and once the
 * in-world car lands it becomes a one-line swap in the composition root.
 */
import { createKeyboardInput, type InputSource, type KeyboardTarget } from "../input/keyboard";
import { getSurface, type Surface } from "../physics/surface";
import { Vehicle, type VehicleInput } from "../physics/vehicle";
import type { HudTelemetry } from "./hud-model";

/** A source the HUD reads each frame, with lifecycle hooks the boot owns. */
export interface TelemetryFeed {
  /** Latest snapshot; must never throw. */
  read(): HudTelemetry;
  /** Advance the source (vehicle step) by one fixed timestep. */
  update(dt: number): void;
  /** Release listeners. Idempotent. */
  dispose(): void;
  /**
   * Optional world position in the x/z plane, for consumers that need arc-length
   * (the pace-note scheduler, #APEX-18). Absent when the source has no position.
   */
  position?(): { x: number; z: number };
}

export interface TelemetryHarnessOptions {
  /** Driver command puller; defaults to keyboard WASD/arrows/space. */
  input?: () => VehicleInput;
  vehicle?: Vehicle;
  /** Surface passed to the vehicle step; defaults to tarmac. */
  surface?: Surface;
  /** Keyboard target when no `input` is supplied; defaults to `window`. */
  keyboardTarget?: KeyboardTarget;
}

const NEUTRAL: HudTelemetry = { speedKmh: 0 };

/**
 * Compose a keyboard-driven vehicle that feeds the HUD real speed telemetry.
 * `update(dt)` must be called with the same fixed step as the race clock.
 */
export function createTelemetryHarness(options: TelemetryHarnessOptions = {}): TelemetryFeed {
  const vehicle = options.vehicle ?? new Vehicle();
  const surface = options.surface ?? getSurface("tarmac");

  let keyboard: InputSource | null = null;
  let readInput = options.input;
  if (!readInput && typeof window !== "undefined") {
    keyboard = createKeyboardInput(options.keyboardTarget ?? (window as unknown as KeyboardTarget));
    readInput = () => keyboard!.read();
  }

  return {
    read: () => {
      if (!readInput) return { ...NEUTRAL };
      return { speedKmh: vehicle.telemetry().speedKmh };
    },
    update: (dt) => {
      if (!readInput) return;
      vehicle.step(readInput(), dt, surface);
    },
    position: () => {
      const state = vehicle.getState();
      return { x: state.x, z: state.z };
    },
    dispose: () => {
      keyboard?.dispose();
      keyboard = null;
    },
  };
}
