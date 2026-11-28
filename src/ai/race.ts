/**
 * Headless race simulation.
 *
 * Threads the racing line, the CPU drivers and #APEX-2's `Vehicle` into a
 * fixed-step, GPU-free race: place a grid, step every car once per fixed `dt`,
 * detect the finish, and account for on-surface compliance and car separation.
 *
 * Difficulty (#APEX-8): `options.tier` scales the CPU field (skill + reaction +
 * aggression) and `options.player` enters a deterministic reference "competent
 * human" pace car. The pace car races the line **solo** at the human skill, so its
 * finish time is a clean pace benchmark the traffic-bound CPU pack is graded
 * against; it is not in the collision field, so a tier can never perturb the
 * #APEX-7 pack. Each step, every CPU behind/ahead of it gets a bounded,
 * skill-capped catch-up ratio applied to its target speed — never a position or
 * velocity change.
 *
 * Pure and deterministic: same circuit + cars + tier + player + seed + dt ⇒
 * identical result. This is the engine behind the visible race scene and the
 * future replay/ghost harness (#APEX-9).
 */
import { sampleSpline } from "../stage/spline";
import { createContainment } from "../stage/containment";
import { clamp } from "../physics/util";
import type { StageCircuit } from "../stage/types";
import { buildRacingLine } from "./racing-line";
import { CpuDriver } from "./driver";
import { physicsSurfaceAt } from "./surface";
import { mulberry32 } from "./rng";
import {
  COMPETENT_HUMAN_SKILL,
  boundedCatchUp,
  difficultyTuning,
  type CatchUpConfig,
} from "./difficulty";
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
/**
 * Fractional jitter applied to a tier's base skill so a field is not identical.
 * Kept small: a wide skill spread reintroduces side-by-side overtaking that costs
 * lap time to the #APEX-27/31 containment guard.
 */
const TIER_SKILL_JITTER = 0.015;

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

/** The reference player id for a race, or `null` when none raced. */
export function playerIdFor(options: RaceOptions): string | null {
  return options.player ? (options.player.id ?? "player") : null;
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
  const tier = options.tier ? difficultyTuning(options.tier) : null;

  const rng = mulberry32(seed);
  const drivers = specs.map((spec, i) => {
    const slot = slots[i]!;
    const lineOffset = spec.lineOffset ?? slot.lineOffset;
    // Deterministic skill: an explicit spec skill always wins, then the tier's
    // skill (with jitter), else #APEX-7's default. RNG is only consumed when a
    // random skill is needed, so omitting `tier` reproduces the #APEX-7 field.
    let skill: number;
    if (spec.skill !== undefined) {
      skill = spec.skill;
    } else if (tier) {
      skill = clamp(tier.skill * (1 - TIER_SKILL_JITTER + 2 * TIER_SKILL_JITTER * rng()), 0.5, 1.3);
    } else {
      skill = 0.9 + 0.08 * rng();
    }
    const tuning = spec.tuning ?? (tier ? tier.driverTuning : options.driverTuning);
    const driver = new CpuDriver({ id: spec.id, skill, lineOffset, tuning });
    driver.setSampleStep(sampleStep);
    driver.placeOnLine(line, slot.distance, lineOffset);
    return driver;
  });

  return { line, drivers, sampleStep, halfWidth };
}

/** Metrics accumulated for one physically-stepped car. */
interface CarMetrics {
  offSurfaceSamples: number;
  maxCrossTrack: number;
  straightSum: number;
  straightCount: number;
  cornerSum: number;
  cornerCount: number;
  maxSpeedDeltaFromReference: number;
  maxStepDisplacement: number;
  prevX: number;
  prevZ: number;
}

function newMetrics(driver: CpuDriver): CarMetrics {
  const s = driver.vehicle.getState();
  return {
    offSurfaceSamples: 0,
    maxCrossTrack: 0,
    straightSum: 0,
    straightCount: 0,
    cornerSum: 0,
    cornerCount: 0,
    maxSpeedDeltaFromReference: 0,
    maxStepDisplacement: 0,
    prevX: s.x,
    prevZ: s.z,
  };
}

function toCarResult(driver: CpuDriver, m: CarMetrics, lineLength: number): CarResult {
  return {
    id: driver.id,
    skill: driver.skill,
    finishTime: driver.finishTime,
    offSurfaceSamples: m.offSurfaceSamples,
    maxCrossTrack: m.maxCrossTrack,
    straightMeanSpeed: m.straightCount > 0 ? m.straightSum / m.straightCount : 0,
    cornerMeanSpeed: m.cornerCount > 0 ? m.cornerSum / m.cornerCount : 0,
    progress: clamp(driver.distance / Math.max(lineLength, 1), 0, 1),
    maxSpeedDeltaFromReference: m.maxSpeedDeltaFromReference,
    maxStepDisplacement: m.maxStepDisplacement,
  };
}

/**
 * Advance a car one fixed step and fold the new state into its metrics.
 *
 * The per-step displacement is measured on the physics integration (before any
 * containment correction) — that is the no-teleport evidence: catch-up only
 * scales a target speed, so a step never moves the car further than its speed
 * allows. The on-ribbon metric is measured after the soft roadside barrier.
 */
function stepAndMeasure(
  driver: CpuDriver,
  input: import("../physics/vehicle").VehicleInput,
  surface: import("../physics/surface").Surface,
  dt: number,
  time: number,
  m: CarMetrics,
  halfWidth: number,
  line: import("./types").RacingLine,
  containment: import("../stage/types").Containment,
): void {
  driver.vehicle.step(input, dt, surface);
  const stepped = driver.vehicle.getState();
  const moved = Math.hypot(stepped.x - m.prevX, stepped.z - m.prevZ);
  m.maxStepDisplacement = Math.max(m.maxStepDisplacement, moved);

  // Re-project onto the racing line so the on-ribbon contract is measured at the
  // car's true post-step position (not the position before the step).
  driver.refreshProgress(line);
  // #APEX-8: the same soft roadside barrier the visible race uses (#APEX-28),
  // with no shoulder, so a faster/ more aggressive tier can never drive off the
  // road. It projects the car back onto the ribbon and damps the excursion — it
  // never teleports (the correction is the overshoot only).
  if (Math.abs(driver.centerOffset) > halfWidth + 1e-6) {
    const result = containment.apply(driver.vehicle);
    if (result.contained) driver.refreshProgress(line);
  }
  const offset = Math.abs(driver.centerOffset);
  m.maxCrossTrack = Math.max(m.maxCrossTrack, offset);
  if (offset > halfWidth + 1e-6) m.offSurfaceSamples += 1;
  const s = driver.vehicle.getState();
  m.prevX = s.x;
  m.prevZ = s.z;

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

/**
 * Simulate a full race on a stage.
 *
 * @param circuit validated stage circuit (#APEX-4)
 * @param options cars, tier, player (reference pace car), seed, step, window
 */
export function simulateRace(circuit: StageCircuit, options: RaceOptions = {}): RaceResult {
  const dt = options.dt && options.dt > 0 ? options.dt : DEFAULT_DT;
  const seed = options.seed ?? 1;
  const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const windowLowFactor = options.windowLowFactor ?? 0.75;
  const windowHighFactor = options.windowHighFactor ?? 1.6;
  const onStep = options.onStep;
  const sampleEvery = options.sampleEvery && options.sampleEvery > 0 ? Math.floor(options.sampleEvery) : 1;
  const playerId = playerIdFor(options);
  const catchUpConfig: CatchUpConfig | null =
    options.tier && playerId ? difficultyTuning(options.tier).catchUp : null;

  // The racing line and sample step are shared by the field and the reference.
  const fieldOptions: RaceOptions = { ...options, player: undefined };
  const { line, drivers, sampleStep, halfWidth } = createRaceField(circuit, fieldOptions);

  // Soft roadside barrier at the ribbon edge (no shoulder): a tiered field can be
  // faster than the #APEX-7 default, so containment is enforced structurally
  // rather than relying on the driver's edge easing alone.
  const containment = createContainment(
    circuit,
    sampleSpline(circuit.spline, circuit.road.sampleStep),
    0,
  );

  const metrics = drivers.map((d) => newMetrics(d));
  const parked = drivers.map(() => false);
  const maxSteps = Math.ceil(maxSeconds / dt);
  let time = 0;
  let minSeparation = Infinity;
  let maxSpeedDelta = 0;
  let catchUpMin = Infinity;
  let catchUpMax = 0;
  let cappedSteps = 0;

  // #APEX-8 reference pace car: a solo, deterministic "competent human" that
  // races the line at the human skill. It is a pace benchmark, not a field car.
  let reference: CpuDriver | null = null;
  let referenceMetrics: CarMetrics | null = null;
  if (playerId !== null) {
    reference = new CpuDriver({
      id: playerId,
      skill: options.player?.skill ?? COMPETENT_HUMAN_SKILL,
    });
    reference.setSampleStep(sampleStep);
    reference.placeOnLine(line, 0, 0);
    referenceMetrics = newMetrics(reference);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const allFinished =
      drivers.every((d) => d.finished) && (reference === null || reference.finished);
    if (allFinished) break;

    // 0a. Step the solo reference pace car.
    if (reference !== null && referenceMetrics !== null && !reference.finished) {
      const t = clamp(reference.distance / Math.max(line.length, 1), 0, 1);
      const surface = physicsSurfaceAt(circuit, t);
      const command = reference.control(line, surface, []);
      if (reference.distance >= line.length - FINISH_TOLERANCE) {
        reference.markFinished(time);
      } else {
        stepAndMeasure(
          reference,
          command,
          surface,
          dt,
          time,
          referenceMetrics,
          halfWidth,
          line,
          containment,
        );
      }
    }

    // 0b. Bounded catch-up (#APEX-8): bias each racing CPU's target speed toward
    //     the reference. This writes only the command scalar via `setCatchUp`.
    if (catchUpConfig && reference !== null) {
      const referenceDistance = reference.distance;
      for (const driver of drivers) {
        if (driver.finished) {
          driver.setCatchUp(1);
          continue;
        }
        const gap = referenceDistance - driver.distance;
        const state = boundedCatchUp(driver.skill, gap, catchUpConfig);
        driver.setCatchUp(state.ratio);
        catchUpMin = Math.min(catchUpMin, state.ratio);
        catchUpMax = Math.max(catchUpMax, state.ratio);
        if (state.capped) cappedSteps += 1;
      }
    }

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
      if (parked[i]) {
        // Finished cars are parked off the line; step them off the clock but do
        // not fold the park jump into the telemetry.
        driver.vehicle.step(inputs[i]!, dt, surface);
        continue;
      }
      stepAndMeasure(driver, inputs[i]!, surface, dt, time, metrics[i]!, halfWidth, line, containment);
    }

    // #APEX-8 bounded speed-delta telemetry: reference speed vs each racing car.
    if (reference !== null) {
      const referenceSpeed = reference.speed();
      for (let i = 0; i < drivers.length; i += 1) {
        if (parked[i]) continue;
        const delta = Math.abs(drivers[i]!.speed() - referenceSpeed);
        metrics[i]!.maxSpeedDeltaFromReference = Math.max(
          metrics[i]!.maxSpeedDeltaFromReference,
          delta,
        );
        maxSpeedDelta = Math.max(maxSpeedDelta, delta);
      }
    }

    // 2. Minimum pairwise centre distance among cars still racing. Finished
    //    cars are parked off the line and excluded — they are no longer racing
    //    and would otherwise queue up on the finish line.
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

  const cars: CarResult[] = drivers.map((driver, i) => toCarResult(driver, metrics[i]!, line.length));
  const referenceResult =
    reference !== null && referenceMetrics !== null
      ? toCarResult(reference, referenceMetrics, line.length)
      : null;

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
    tier: options.tier ?? null,
    playerId,
    reference: referenceResult,
    maxSpeedDelta: playerId === null ? 0 : maxSpeedDelta,
    catchUp:
      catchUpConfig && playerId !== null
        ? {
            minRatio: Number.isFinite(catchUpMin) ? catchUpMin : 1,
            maxRatio: catchUpMax,
            cappedSteps,
          }
        : null,
  };
}
