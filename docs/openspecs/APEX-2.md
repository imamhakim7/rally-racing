# APEX-2 — Arcade Rally Vehicle Handling with Surface-Dependent Grip

Epic: `2026-Q4-APEX-RALLY-APEX-01` — Race Core & Vehicle Handling.
Depends on `#APEX-1` (fixed-timestep loop) and unblocks `#APEX-3` (race loop) / `#APEX-7`.

## Problem

Rally handling — weight transfer, drifting and surface-dependent grip — is the core feel of
the game. Without a defined vehicle model every later stage (race loop, AI, stage surfaces)
would improvise its own, so the handling could never be tuned or measured consistently.

## Goal

Drive a rally car with dependable arcade handling: acceleration, braking, handbrake drift,
speed-sensitive steering and per-surface grip (tarmac, gravel, mud, ice).

## Non-goals

- The race state machine, countdown and checkpoints (`#APEX-3`) — this ticket only provides
  the drivable vehicle.
- Asset/audio pipeline, AI opponents, damage, a full tyre/thermal model.
- Accurate vehicle dynamics — this is a tuned *arcade* model, not a simulator.

## Design

A single-track ("bicycle") model integrated in the body frame at the `#APEX-1` fixed step.
Body axes: `vLong` forward, `vLat` to the right; `yaw` maps body→world as forward
`(sin yaw, cos yaw)`.

### Modules (`src/physics/`)

| Module | Responsibility |
| --- | --- |
| `pacejka.ts` | Simplified Pacejka magic formula `F = peak·sin(shape·atan(stiffness·slip))` — odd, bounded, smooth; `pacejkaPeakSlip()` for tuning/tests. |
| `surface.ts` | `Surface` (lateral + longitudinal grip, rolling resistance, colour), `SURFACES` for tarmac/gravel/mud/ice, and a `SurfaceMap` zone lookup (`createLaneSurfaceMap`). |
| `vehicle.ts` | `Vehicle`: the `step(input, dt, surface)` integrator + telemetry. |
| `debug.ts` | DOM-free HUD view-model (`toDebugHud`, `formatDebugHud`). |
| `util.ts` | `clamp`, `clamp01`, `wrapAngle`, `damp` (frame-rate-independent smoothing). |

Supporting modules: `src/input/keyboard.ts` (WASD/arrows/space → `VehicleInput`),
`src/ui/debugOverlay.ts` (writes the HUD into a supplied element),
`src/scenes/physicsTestScene.ts` (drivable `SceneHandle` on the four-surface test track),
and `src/main.ts` (boots the scene, keyboard and overlay).

### Forces per fixed step

1. **Steering** — road-wheel angle is rate-limited toward a *speed-sensitive* target:
   `maxSteerAngle · steer · 1/(1 + falloff·speed)`, so it is calm at speed and quick at rest.
2. **Longitudinal** — throttle drives (tapering to zero at `maxSpeed`); the brake opposes the
   direction of travel and, once nearly stopped, drives the car in reverse (one axis covers
   braking *and* reversing). Engine and brake force both scale with surface grip.
3. **Lateral** — a simplified-Pacejka force per axle, with the peak scaled by surface
   lateral grip and the static axle load. The handbrake multiplies the **rear** peak by
   `handbrakeGrip` and adds rear drag, so the tail steps out into a controlled drift.
4. **Yaw** — moment `a·Ffront − b·Frear`, with tyre-relaxation yaw damping so a drift
   recovers instead of spinning; lateral bleed is applied only after the handbrake is
   released.
5. **Integration** — body-frame accelerations include the rotating-frame coupling terms;
   yaw, then world pose, are integrated explicitly.

### Interfaces

```ts
type SurfaceId = "tarmac" | "gravel" | "mud" | "ice";
interface Surface {
  id: SurfaceId; label: string;
  lateralGrip: number; longitudinalGrip: number;
  rollingResistance: number; color: number;
}

interface VehicleInput { throttle: number; brake: number; steer: number; handbrake: boolean }

class Vehicle {
  step(input: VehicleInput, dt: number, surface: Surface): void;
  computeSteerAngle(steerInput: number, speed: number): number; // speed-sensitive
  telemetry(): VehicleTelemetry;                                // speed, slip, yaw, drift
  getState(): VehicleState; setState(p: Partial<VehicleState>): void; reset(p?): void;
}
```

### Invariants

1. `step` is a pure function of `(state, input, dt, surface)` — no clock, no globals, no
   `Math.random`, so a given input sequence is exactly reproducible.
2. The model only ever sees the loop's fixed `dt`; display frame rate changes *how many*
   steps run per frame, never the step size → frame-rate independent.
3. Tyre force is bounded by the surface-scaled peak; `pacejka` is odd and finite.
4. A drift is recoverable: yaw damping + restored rear grip return the car to a low body
   slip angle after the handbrake is released.

### Edge cases

- Zero / negative / non-finite `dt`: no-op (no NaN).
- Inputs are clamped: throttle/brake to `[0,1]`, steer to `[-1,1]`.
- At rest the car does not creep (low-speed relaxation) and reports 0 km/h.
- Slip angles guard the low-speed `atan2(0,0)` singularity with a speed floor.

## Acceptance criteria (Given/When/Then)

- **AC1 Accelerate / brake / reverse** — Given a standing car, When throttle is held on
  tarmac, Then it exceeds 8 m/s in 2 s; When the brake is then held, Then it slows faster
  than coasting; When the brake is held from rest, Then it drives in reverse.
- **AC2 Speed-sensitive steering** — Given the same full steer input, When speed rises from
  0 to 30 m/s, Then the commanded road-wheel angle strictly decreases; the applied angle at
  speed is smaller than at crawl.
- **AC3 Handbrake drift recovers** — Given a car at ~18 m/s, When full steer + handbrake are
  applied, Then the body slip angle exceeds 0.15 rad and `drifting` is true; When the
  handbrake is released and steering centred, Then the slip angle falls below the drift
  value and under 0.08 rad.
- **AC4 Per-surface grip differs, measurably** — Given the same entry line, When driving
  tarmac vs gravel, Then gravel turns less (a wider line), shows a larger front slip angle,
  takes longer to reach the same heading and brakes over a longer distance.
- **AC5 Frame-rate independent** — Given identical inputs and simulated time, When the
  simulation is driven at 30 / 60 / 144 fps, Then the number of fixed steps and the final
  pose (x, z, yaw, vLong, vLat, yawRate) are identical.
- **AC6 Debug overlay** — Given telemetry and a surface, Then the HUD text shows speed
  (km/h), slip (body + per-axle) and the surface label, and the overlay records
  `data-surface` / `data-drifting`.

## How to test

- `bun run test` — `tests/pacejka.test.ts`, `tests/surface.test.ts`, `tests/vehicle.test.ts`,
  `tests/framerate.test.ts`, `tests/debug.test.ts`, `tests/input.test.ts`,
  `tests/physicsTestScene.test.ts`.
- `bun run typecheck` — clean.
- `bun run build && bun scripts/screenshot.mjs` — drives the built app in headless Chromium
  (SwiftShader WebGL2), writes `docs/evidence/APEX-2-scene.png` (driving, gravel) and
  `docs/evidence/APEX-2-drift.png` (handbrake drift, mud) and prints the live overlay text.
- Manual: `bun run dev`, drive the same line on tarmac then gravel — the gravel line runs
  wider and scrubs speed; Space flicks the tail out and releasing it recovers.

## Evidence

- `docs/evidence/APEX-2-tests.txt` — `tsc --noEmit` clean, **53/53** Vitest tests pass,
  `vite build` succeeds, headless screenshot run `ok: true`.
- `docs/evidence/APEX-2-scene.png` — 1280×720 WebGL2; overlay `Surface Gravel`, ~48 km/h.
- `docs/evidence/APEX-2-drift.png` — 1280×720 WebGL2; overlay `Surface Mud • DRIFT`,
  body slip −23°, components clean.
