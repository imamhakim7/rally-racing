import { describe, expect, it } from "vitest";
import {
  a11yAttributes,
  applyA11y,
  systemPrefersReducedMotion,
  type A11yRoot,
} from "../src/ui/a11y";
import { AA_NORMAL, PALETTES, contrastRatio, paletteVars } from "../src/ui/palette";
import { COLOR_BLIND_MODES, defaultSettings, type GameSettings } from "../src/input/settings";

function settingsWith(overrides: Partial<GameSettings["accessibility"]>): GameSettings {
  const base = defaultSettings();
  return { ...base, accessibility: { ...base.accessibility, ...overrides } };
}

describe("a11y projection (AC3/AC4/AC5)", () => {
  it("projects motion, palette and text scale to data attributes + css vars", () => {
    const projection = a11yAttributes(
      settingsWith({ reducedMotion: "on", colorBlindMode: "deuteranopia", textScale: 1.5 }),
      false,
    );
    expect(projection.dataset).toMatchObject({ motion: "reduced", palette: "deuteranopia", textScale: "1.50" });
    expect(projection.cssVars["--apex-text-scale"]).toBe("1.5");
    expect(projection.cssVars["--apex-good"]).toBe(PALETTES.deuteranopia.colors.good);
  });

  it("follows the system reduce flag only for the 'auto' preference", () => {
    expect(a11yAttributes(settingsWith({ reducedMotion: "auto" }), true).dataset.motion).toBe("reduced");
    expect(a11yAttributes(settingsWith({ reducedMotion: "auto" }), false).dataset.motion).toBe("full");
    expect(a11yAttributes(settingsWith({ reducedMotion: "off" }), true).dataset.motion).toBe("full");
    expect(a11yAttributes(settingsWith({ reducedMotion: "on" }), false).dataset.motion).toBe("reduced");
  });

  it("writes dataset + css vars onto a root", () => {
    const vars: Record<string, string> = {};
    const root: A11yRoot = { dataset: {}, style: { setProperty: (n, v) => void (vars[n] = v) } };
    applyA11y(root, a11yAttributes(settingsWith({ colorBlindMode: "protanopia", textScale: 2 }), true));
    expect(root.dataset).toMatchObject({ motion: "reduced", palette: "protanopia" });
    expect(vars["--apex-text-scale"]).toBe("2");
    expect(vars["--apex-accent"]).toBe(PALETTES.protanopia.colors.accent);
  });

  it("reads the system preference through a port, failing safe", () => {
    expect(systemPrefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(systemPrefersReducedMotion(() => null)).toBe(false);
    expect(systemPrefersReducedMotion(() => {
      throw new Error("no matchMedia");
    })).toBe(false);
  });
});

describe("palette contrast (AC3)", () => {
  it("has a palette for every colour-blind mode with distinct good/bad", () => {
    for (const id of COLOR_BLIND_MODES) {
      const palette = PALETTES[id];
      expect(palette, id).toBeDefined();
      expect(palette.colors.good).not.toBe(palette.colors.bad);
    }
  });

  it("meets WCAG AA contrast for every foreground against the panel background", () => {
    for (const palette of Object.values(PALETTES)) {
      for (const key of ["fg", "muted", "accent", "good", "bad"] as const) {
        const ratio = contrastRatio(palette.colors[key], palette.colors.panelBg);
        expect(ratio, `${palette.id}.${key} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  it("emits the semantic CSS custom properties", () => {
    expect(Object.keys(paletteVars("default")).sort()).toEqual(
      ["--apex-accent", "--apex-bad", "--apex-fg", "--apex-good", "--apex-muted"].sort(),
    );
  });
});
