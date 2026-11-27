import { describe, expect, it } from "vitest";
import { getSurface } from "../src/physics/surface";
import { Vehicle, type VehicleInput } from "../src/physics/vehicle";
import { wrapAngle } from "../src/physics/util";

const DT = 1 / 60;
const TARMAC = getSurface("tarmac");
const GRAVEL = getSurface("gravel");

function stepFor(
  vehicle: Vehicle,
  input: VehicleInput,
  surface = TARMAC,
  seconds = 1,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) vehicle.step(input, DT, surface);
}

const DRIVE: VehicleInput = { throttle: 1, brake: 0, steer: 0, handbrake: false };

describe("Vehicle — longitudinal handling", () => {
  it("accelerates from rest under throttle", () => {
    const car = new Vehicle();
    stepFor(car, DRIVE, TARMAC, 2);
    expect(car.getState().vLong).toBeGreaterThan(8);
    expect(car.telemetry().speed).toBeGreaterThan(8);
  });

  it("brakes to a stop much faster than it coasts", () => {
    const braked = new Vehicle();
    const coasted = new Vehicle();
    stepFor(braked, DRIVE, TARMAC, 3);
    stepFor(coasted, DRIVE, TARMAC, 3);
    const before = braked.getState().vLong;

    const BRAKE: VehicleInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
    stepFor(braked, BRAKE, TARMAC, 1.5);
    stepFor(coasted, { throttle: 0, brake: 0, steer: 0, handbrake: false }, TARMAC, 1.5);

    expect(braked.getState().vLong).toBeLessThan(coasted.getState().vLong);
    expect(before).toBeGreaterThan(10);
  });

  it("reverses when the brake is held from standstill", () => {
    const car = new Vehicle();
    const REVERSE: VehicleInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
    stepFor(car, REVERSE, TARMAC, 2);
    expect(car.getState().vLong).toBeLessThan(-1);
    expect(car.getState().z).toBeLessThan(0);
  });

  it("does not creep when left alone at rest", () => {
    const car = new Vehicle();
    const IDLE: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    stepFor(car, IDLE, TARMAC, 3);
    const { x, z, vLong } = car.getState();
    expect(Math.hypot(x, z)).toBeLessThan(1e-6);
    expect(Math.abs(vLong)).toBeLessThan(1e-6);
  });
});

describe("Vehicle — speed-sensitive steering", () => {
  it("reduces the commanded steer angle as speed rises", () => {
    const car = new Vehicle();
    const atRest = car.computeSteerAngle(1, 0);
    const atSpeed = car.computeSteerAngle(1, 30);
    expect(atSpeed).toBeLessThan(atRest);
    expect(atSpeed).toBeGreaterThan(0);
  });

  it("applies a smaller road-wheel angle at high speed", () => {
    const slow = new Vehicle();
    slow.setState({ vLong: 2 });
    stepFor(slow, { throttle: 0.2, brake: 0, steer: 1, handbrake: false }, TARMAC, 0.5);

    const fast = new Vehicle();
    fast.setState({ vLong: 40 });
    stepFor(fast, { throttle: 0.2, brake: 0, steer: 1, handbrake: false }, TARMAC, 0.5);

    expect(fast.telemetry().steerAngle).toBeLessThan(slow.telemetry().steerAngle);
  });

  it("turns the heading in the commanded direction", () => {
    const right = new Vehicle();
    right.setState({ vLong: 15 });
    stepFor(right, { throttle: 0.6, brake: 0, steer: 1, handbrake: false }, TARMAC, 1);
    expect(right.getState().yaw).toBeGreaterThan(0);

    const left = new Vehicle();
    left.setState({ vLong: 15 });
    stepFor(left, { throttle: 0.6, brake: 0, steer: -1, handbrake: false }, TARMAC, 1);
    expect(left.getState().yaw).toBeLessThan(0);
  });
});

describe("Vehicle — handbrake drift", () => {
  it("initiates a drift that recovers when the handbrake is released", () => {
    const car = new Vehicle();
    stepFor(car, DRIVE, TARMAC, 3);

    // Flick the tail out with the handbrake.
    stepFor(
      car,
      { throttle: 0.3, brake: 0, steer: 1, handbrake: true },
      TARMAC,
      0.6,
    );
    const drifting = Math.abs(car.telemetry().slipAngle);
    expect(car.telemetry().drifting).toBe(true);
    expect(drifting).toBeGreaterThan(0.15);

    // Release and straighten: grip returns and the car settles.
    stepFor(
      car,
      { throttle: 0.3, brake: 0, steer: 0, handbrake: false },
      TARMAC,
      2,
    );
    const recovered = Math.abs(car.telemetry().slipAngle);
    expect(recovered).toBeLessThan(drifting);
    expect(recovered).toBeLessThan(0.08);
  });
});

describe("Vehicle — surface-dependent grip", () => {
  function headingGain(surface: typeof TARMAC, seconds: number): number {
    const car = new Vehicle();
    car.setState({ vLong: 18 });
    const input: VehicleInput = { throttle: 0.5, brake: 0, steer: 1, handbrake: false };
    const start = car.getState().yaw;
    stepFor(car, input, surface, seconds);
    return Math.abs(wrapAngle(car.getState().yaw - start));
  }

  it("turns less (a wider line) on gravel than on tarmac", () => {
    const tarmac = headingGain(TARMAC, 2);
    const gravel = headingGain(GRAVEL, 2);
    expect(gravel).toBeLessThan(tarmac);
    expect(tarmac - gravel).toBeGreaterThan(0.05);
  });

  it("slides wider — a larger front slip angle — on gravel", () => {
    const car = new Vehicle();
    car.setState({ vLong: 18 });
    stepFor(car, { throttle: 0.5, brake: 0, steer: 1, handbrake: false }, GRAVEL, 1.2);
    const gravelSlip = Math.abs(car.telemetry().slipAngleFront);

    car.reset({ vLong: 18 });
    stepFor(car, { throttle: 0.5, brake: 0, steer: 1, handbrake: false }, TARMAC, 1.2);
    const tarmacSlip = Math.abs(car.telemetry().slipAngleFront);

    expect(gravelSlip).toBeGreaterThan(tarmacSlip);
  });

  it("takes longer to reach the same heading on gravel", () => {
    function timeToHeading(surface: typeof TARMAC, target: number): number {
      const car = new Vehicle();
      car.setState({ vLong: 18 });
      const input: VehicleInput = { throttle: 0.5, brake: 0, steer: 1, handbrake: false };
      const start = car.getState().yaw;
      for (let i = 0; i < 60 * 15; i++) {
        car.step(input, DT, surface);
        if (Math.abs(wrapAngle(car.getState().yaw - start)) >= target) return i * DT;
      }
      return Number.POSITIVE_INFINITY;
    }

    const tarmac = timeToHeading(TARMAC, 1.0);
    const gravel = timeToHeading(GRAVEL, 1.0);
    expect(tarmac).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(gravel).toBeGreaterThan(tarmac);
  });

  it("brakes over a longer distance on gravel", () => {
    function brakingDistance(surface: typeof TARMAC): number {
      const car = new Vehicle();
      // Same entry speed on both surfaces, so only grip differs.
      car.reset({ vLong: 20 });
      const startZ = car.getState().z;
      const BRAKE: VehicleInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
      for (let i = 0; i < 60 * 10; i++) {
        car.step(BRAKE, DT, surface);
        if (car.getState().vLong <= 0.1) break;
      }
      return Math.abs(car.getState().z - startZ);
    }
    expect(brakingDistance(GRAVEL)).toBeGreaterThan(brakingDistance(TARMAC));
  });
});
