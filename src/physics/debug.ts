/**
 * Debug-HUD view model: turns vehicle telemetry + the current surface into
 * plain data, then formats it for the on-screen overlay. Kept DOM-free so the
 * exact text can be asserted in a headless test.
 */

import type { Surface } from "./surface";
import type { VehicleTelemetry } from "./vehicle";

export interface DebugHudState {
  speedKmh: number;
  forwardSpeed: number;
  lateralSpeed: number;
  slipAngleDeg: number;
  slipAngleFrontDeg: number;
  slipAngleRearDeg: number;
  steerAngleDeg: number;
  yawRateDeg: number;
  drifting: boolean;
  surface: string;
}

const RAD_TO_DEG = 180 / Math.PI;

export function toDebugHud(telemetry: VehicleTelemetry, surface: Surface): DebugHudState {
  return {
    speedKmh: telemetry.speedKmh,
    forwardSpeed: telemetry.forwardSpeed,
    lateralSpeed: telemetry.lateralSpeed,
    slipAngleDeg: telemetry.slipAngle * RAD_TO_DEG,
    slipAngleFrontDeg: telemetry.slipAngleFront * RAD_TO_DEG,
    slipAngleRearDeg: telemetry.slipAngleRear * RAD_TO_DEG,
    steerAngleDeg: telemetry.steerAngle * RAD_TO_DEG,
    yawRateDeg: telemetry.yawRate * RAD_TO_DEG,
    drifting: telemetry.drifting,
    surface: surface.label,
  };
}

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value >= 0 ? `+${fixed}` : fixed;
}

/** Multi-line HUD text: speed, longitudinal/lateral split, slip, surface. */
export function formatDebugHud(hud: DebugHudState): string {
  return [
    `Speed    ${hud.speedKmh.toFixed(0)} km/h`,
    `Fwd/Lat  ${signed(hud.forwardSpeed)} / ${signed(hud.lateralSpeed)} m/s`,
    `Slip     ${signed(hud.slipAngleDeg)}°  (F ${signed(hud.slipAngleFrontDeg)}° / R ${signed(hud.slipAngleRearDeg)}°)`,
    `Steer    ${signed(hud.steerAngleDeg)}°   Yaw ${signed(hud.yawRateDeg, 0)}°/s`,
    `Surface  ${hud.surface}${hud.drifting ? "  • DRIFT" : ""}`,
  ].join("\n");
}
