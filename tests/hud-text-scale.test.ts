// Regression for #APEX-37 (found in QA of #APEX-12 AC5): the prominent race HUD
// readouts must respond to the user's text-size setting. A `font-size: clamp(...)`
// rule that does not multiply by `var(--apex-text-scale)` stays fixed at 200%,
// which is exactly the defect QA proved.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/race/hud.ts", import.meta.url), "utf8");

describe("HUD text scaling (#APEX-37 / #APEX-12 AC5)", () => {
  it("multiplies every fixed clamp() HUD font-size by --apex-text-scale", () => {
    const rules = [...source.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    const fixedClamps = rules.filter((value) => value.includes("clamp("));
    expect(fixedClamps.length).toBeGreaterThanOrEqual(4);
    for (const value of fixedClamps) {
      expect(value, `font-size "${value}" must scale with --apex-text-scale`).toContain(
        "--apex-text-scale",
      );
    }
  });

  it("scales the prominent readouts specifically", () => {
    for (const selector of [
      ".apex-countdown",
      ".apex-live .apex-time",
      ".apex-speed .apex-speed-value",
      ".apex-notes .apex-notes-call",
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = source.match(new RegExp(`${escaped}\\s*\\{[^}]*?font-size:\\s*([^;]+);`, "s"));
      expect(rule, `no font-size rule found for ${selector}`).toBeTruthy();
      expect(rule![1]).toContain("--apex-text-scale");
    }
  });
});
