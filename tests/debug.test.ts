import { describe, expect, it } from "vitest";
import { formatDebugHud, toDebugHud } from "../src/physics/debug";
import { getSurface } from "../src/physics/surface";
import { Vehicle } from "../src/physics/vehicle";
import { createDebugOverlay } from "../src/ui/debugOverlay";

function stubElement(): HTMLElement & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    textContent: "",
    attrs,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
  } as unknown as HTMLElement & { attrs: Map<string, string> };
}

describe("debug HUD", () => {
  it("converts telemetry to degrees and carries the surface label", () => {
    const car = new Vehicle();
    car.setState({ vLong: 10, vLat: 1, yawRate: 1 });
    const hud = toDebugHud(car.telemetry(), getSurface("gravel"));
    expect(hud.surface).toBe("Gravel");
    expect(hud.slipAngleDeg).toBeCloseTo(5.71, 1);
    expect(hud.yawRateDeg).toBeCloseTo(57.3, 1);
  });

  it("formats speed, slip and surface into readable lines", () => {
    const car = new Vehicle();
    car.setState({ vLong: 20 });
    const text = formatDebugHud(toDebugHud(car.telemetry(), getSurface("ice")));
    expect(text).toContain("Speed");
    expect(text).toContain("km/h");
    expect(text).toContain("Slip");
    expect(text).toContain("Ice");
  });
});

describe("debug overlay", () => {
  it("writes telemetry text and surface/drift attributes to the element", () => {
    const element = stubElement();
    const overlay = createDebugOverlay(element);
    const car = new Vehicle();
    car.setState({ vLong: 20 });
    overlay.update(car.telemetry(), getSurface("mud"));

    expect(element.textContent).toContain("Mud");
    expect(element.attrs.get("data-surface")).toBe("mud");
    expect(element.attrs.get("data-drifting")).toBe("false");
  });

  it("clears the element on dispose", () => {
    const element = stubElement();
    const overlay = createDebugOverlay(element);
    overlay.dispose();
    expect(element.textContent).toBe("");
  });
});
