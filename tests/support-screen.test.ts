import { describe, expect, it } from "vitest";
import { supportScreenContent } from "../src/ui/supportScreen";
import { forcedUnsupportedAssessment } from "../src/engine/capabilities";

describe("supportScreenContent (AC2/AC5)", () => {
  it("renders an actionable screen for the unsupported verdict", () => {
    const content = supportScreenContent(forcedUnsupportedAssessment());
    expect(content.title).toMatch(/can't run/i);
    expect(content.summary).toMatch(/WebGL2|forced-unsupported/);
    expect(content.reasons).toEqual(["WebGL2"]);
    expect(content.steps.length).toBeGreaterThanOrEqual(3);
    expect(content.steps.join(" ")).toMatch(/update|hardware acceleration|browser/i);
  });

  it("falls back to a WebGL2 reason when none is recorded", () => {
    const content = supportScreenContent({
      level: "unsupported",
      reason: "no context",
      missing: [],
      degraded: [],
      preset: "low",
    });
    expect(content.reasons).toEqual(["WebGL2"]);
  });

  it("is deterministic and does not mutate the assessment", () => {
    const assessment = forcedUnsupportedAssessment();
    const snapshot = JSON.parse(JSON.stringify(assessment));
    expect(supportScreenContent(assessment)).toEqual(supportScreenContent(assessment));
    expect(assessment).toEqual(snapshot);
  });
});
