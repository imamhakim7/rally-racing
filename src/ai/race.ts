/**
 * Headless race simulation.
 *
 * Threads the racing line, the CPU drivers and #APEX-2's `Vehicle` into a
 * fixed-step, GPU-free race: place a grid, step every car once per fixed `dt`,
 * detect the finish, and account for on-surface compliance and car separation.
 *
 * Pure and deterministic: same circuit + cars + seed + dt ⇒ identical result.
 * This is the engine behind the visible race scene and the future replay/ghost
 * harness (#APEX-9).
 */
import { sampleSpline } from "../stage/spline";
import { clamp } from "../physics/util";
import type { StageCircuit } from "../stage/types";
import { buildRacingLine } from "./racing-line";
import { CpuDriver } from "./driver";
import { physicsSurfaceAt } from "./surface";
import { mulberry32 } from "./rng";
import type { CarResult, CpuCarSpec, RaceOptions, RaceResult } from "./types";

const DEFAULT_DT = 1 / 60;
const DEFAULT_MAX_SECONDS = 240;
const DEFAULT_CARS = 4;
/** Curvature (1/m) above which a sample counts as a corner for the AC2 metric. */
const CORNER_CURVATURE = 0.012;
/** Finish is detected within this many metres of the line end. */
const FINISH_TOLERANCE = 0.5;
/** Ignore the standing start when measuring straight-vs-corner speed (s). */
const LAUNCH_SECONDS = 3;
/** Rows of two cars, spaced this far apart along the road. */
const ROW_GAP = 8;

interface GridSlot {
  distance: number;
  lineOffset: number;
}

/** Move a finished car off the racing line so it cannot block later finishers. */
export function parkOffLineCar(
  driver: CpuDriver,
  line: import("./types").RacingLine,
  halfWidth: number,
  slot = 0,
): void {
  const end = line.points[line.points.length - 1]!;
  // Distinct lateral slots so two finishers never park on the same point.
  const lateral = halfWidth + 3 + slot * 2.8;
  driver.vehicle.setState({
    x: end.position.x + end.normal.x * lateral,
    z: end.position.z + end.normal.z * lateral,
    vLong: 0,
    vLat: 0,
    yawRate: 0,
  });
}

/** A staggered two-per-row grid: front row ahead, columns to either side. */
function gridSlots(count: number, halfWidth: number, laneFactor: number): GridSlot[] {
  const rows = Math.ceil(count / 2);
  const lane = clamp(halfWidth * laneFactor, 0.8, 2.2);
  const slots: GridSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    slots.push({
      distance: (rows - 1 - row) * ROW_GAP,
      lineOffset: col === 0 ? -lane : lane,
    });
  }
  return slots;
}

/** A placed race field: the shared racing line plus the grid of CPU drivers. */
export interface RaceField {
  line: import("./types").RacingLine;
  drivers: CpuDriver[];
  sampleStep: number;
  halfWidth: number;
}

/**
 * Build the racing line and place a starting grid of CPU drivers on it.
 * Shared by {@link simulateRace} and the visible race scene so both race the
 * exact same field.
 */
export function createRaceField(circuit: StageCircuit, options: RaceOptions = {}): RaceField {
  const seed = options.seed ?? 1;
  const spline = sampleSpline(circuit.spline, circuit.road.sampleStep);
  const line = buildRacingLine(circuit, spline);
  const sampleStep = circuit.road.sampleStep;
  const halfWidth = circuit.road.width / 2;

  const specs: CpuCarSpec[] =
    options.cars && options.cars.length > 0
      ? options.cars
      : Array.from({ length: DEFAULT_CARS }, (_, i) => ({ id: `cpu-${i + 1}` }));
  const slots = gridSlots(specs.length, halfWidth, 0.42);

  const rng = mulberry32(seed);
  const drivers = specs.map((spec, i) => {
    const skill = spec.skill ?? 0.9 + 0.08 * rng();
    const slot = slots[i]!;
    const lineOffset = spec.lineOffset ?? slot.lineOffset;
    const driver = new CpuDriver({ id: spec.id, skill, lineOffset, tuning: options.driverTuning });
    driver.setSampleStep(sampleStep);
    driver.placeOnLine(line, slot.distance, lineOffset);
    return driver;
  });

  return { line, drivers, sampleStep, halfWidth };
}

/**
 * Simulate a full race on a stage.
 *
 * @param circuit validated stage circuit (#APEX-4)
 * @param options cars, seed, step and window factors
 */
export function simulateRace(circuit: StageCircuit, options: RaceOptions = {}): RaceResult {
  const dt = options.dt && options.dt > 0 ? options.dt : DEFAULT_DT;
  const seed = options.seed ?? 1;
  const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const windowLowFactor = options.windowLowFactor ?? 0.75;
  const windowHighFactor = options.windowHighFactor ?? 1.6;
  const onStep = options.onStep;
  const sampleEvery = options.sampleEvery && options.sampleEvery > 0 ? Math.floor(options.sampleEvery) : 1;

  const { line, drivers, halfWidth } = createRaceField(circuit, options);

  const metrics = drivers.map(() => ({
    offSurfaceSamples: 0,
    maxCrossTrack: 0,
    straightSum: 0,
    straightCount: 0,
    cornerSum: 0,
    cornerCount: 0,
  }));

  const parked = drivers.map(() => false);
  const maxSteps = Math.ceil(maxSeconds / dt);
  let time = 0;
  let minSeparation = Infinity;

  for (let step = 0; step < maxSteps; step += 1) {
    const allFinished = drivers.every((d) => d.finished);
    if (allFinished) break;

    // 1. Sample each driver's command from the same world snapshot, step it in
    //    a stable order, then account for the new state.
    const inputs = drivers.map((driver, i) => {
      if (driver.finished) {
        parked[i] = true;
        return { throttle: 0, brake: 0, steer: 0, handbrake: false };
      }
      const t = clamp(driver.distance / Math.max(line.length, 1), 0, 1);
      const command = driver.control(line, physicsSurfaceAt(circuit, t), drivers);
      if (driver.distance >= line.length - FINISH_TOLERANCE) {
        driver.markFinished(time);
        parkOffLineCar(driver, line, halfWidth, i);
        parked[i] = true;
        return { throttle: 0, brake: 0, steer: 0, handbrake: false };
      }
      return command;
    });

    for (let i = 0; i < drivers.length; i += 1) {
      const driver = drivers[i]!;
      const t = clamp(driver.distance / Math.max(line.length, 1), 0, 1);
      const surface = physicsSurfaceAt(circuit, t);
      driver.vehicle.step(inputs[i]!, dt, surface);

      if (!driver.finished) {
        const m = metrics[i]!;
        const offset = Math.abs(driver.centerOffset);
        m.maxCrossTrack = Math.max(m.maxCrossTrack, offset);
        if (offset > halfWidth + 1e-6) m.offSurfaceSamples += 1;
        // Skip the standing start so the launch does not pollute the comparison.
        if (time >= LAUNCH_SECONDS) {
          const v = driver.speed();
          if (Math.abs(driver.curvature) > CORNER_CURVATURE) {
            m.cornerSum += v;
            m.cornerCount += 1;
          } else {
            m.straightSum += v;
            m.straightCount += 1;
          }
        }
      }
    }

    // 2. Minimum pairwise centre distance among cars still racing. Finished
    //    cars are parked off the line (below) and excluded — they are no longer
    //    racing and would otherwise queue up on the finish line.
    for (let i = 0; i < drivers.length; i += 1) {
      if (parked[i]) continue;
      for (let j = i + 1; j < drivers.length; j += 1) {
        if (parked[j]) continue;
        const a = drivers[i]!.position();
        const b = drivers[j]!.position();
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < minSeparation) minSeparation = d;
      }
    }

    // #APEX-9: observation only — capture a replay frame for the state at `time`.
    // Fired after this step's vehicle updates so it exactly describes step `n`.
    if (onStep && step % sampleEvery === 0) {
      onStep({
        step,
        time,
        cars: drivers.map((driver) => {
          const s = driver.vehicle.getState();
          return {
            x: s.x,
            z: s.z,
            yaw: s.yaw,
            speed: driver.speed(),
            progress: clamp(driver.distance / Math.max(line.length, 1), 0, 1),
          };
        }),
      });
    }

    time += dt;
  }

  const cars: CarResult[] = drivers.map((driver, i) => {
    const m = metrics[i]!;
    return {
      id: driver.id,
      skill: driver.skill,
      finishTime: driver.finishTime,
      offSurfaceSamples: m.offSurfaceSamples,
      maxCrossTrack: m.maxCrossTrack,
      straightMeanSpeed: m.straightCount > 0 ? m.straightSum / m.straightCount : 0,
      cornerMeanSpeed: m.cornerCount > 0 ? m.cornerSum / m.cornerCount : 0,
      progress: clamp(driver.distance / Math.max(line.length, 1), 0, 1),
    };
  });

  const finishOrder = [...cars]
    .sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.progress - a.progress;
    })
    .map((c) => c.id);

  return {
    stageId: circuit.id,
    seed,
    dt,
    cars,
    finishOrder,
    minSeparation: Number.isFinite(minSeparation) ? minSeparation : Infinity,
    referenceTime: line.referenceTime,
    window: [windowLowFactor * line.referenceTime, windowHighFactor * line.referenceTime],
    complete: cars.every((c) => c.finishTime !== null),
  };
}
