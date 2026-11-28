/**
 * Colour-blind-safe palettes (#APEX-12).
 *
 * Colour is never the *only* signal (splits keep a sign + glyph, the player's
 * result row is bold + labelled), so this layer only guarantees that the semantic
 * colours stay distinguishable and meet WCAG AA contrast against the panel
 * background for every palette variant — including the colour-blind ones.
 */
import type { ColorBlindMode } from "../input/settings";

export interface PaletteColors {
  /** Primary text. */
  fg: string;
  /** Secondary/muted text. */
  muted: string;
  /** Accent (time, minimap dot, active call). */
  accent: string;
  /** Positive semantic (ahead of pace, valid result). */
  good: string;
  /** Negative semantic (behind pace, penalty). */
  bad: string;
  /** Effective panel background the text sits on (composited over the canvas). */
  panelBg: string;
}

export interface Palette {
  id: ColorBlindMode;
  label: string;
  colors: PaletteColors;
}

export const PANEL_BACKGROUND = "#0c1016";

export const PALETTES: Record<ColorBlindMode, Palette> = {
  default: {
    id: "default",
    label: "Default",
    colors: {
      fg: "#eaf2ff",
      muted: "#a9bdd6",
      accent: "#7fd0ff",
      good: "#6ee7a0",
      bad: "#ff8f6b",
      panelBg: PANEL_BACKGROUND,
    },
  },
  deuteranopia: {
    id: "deuteranopia",
    label: "Deuteranopia (red–green)",
    colors: {
      fg: "#eef4ff",
      muted: "#bcc9dd",
      accent: "#d9e6ff",
      good: "#56b4ff",
      bad: "#ffc046",
      panelBg: PANEL_BACKGROUND,
    },
  },
  protanopia: {
    id: "protanopia",
    label: "Protanopia (red–green)",
    colors: {
      fg: "#eef4ff",
      muted: "#bcc9dd",
      accent: "#d9e6ff",
      good: "#3ec9f0",
      bad: "#ffc046",
      panelBg: PANEL_BACKGROUND,
    },
  },
  tritanopia: {
    id: "tritanopia",
    label: "Tritanopia (blue–yellow)",
    colors: {
      fg: "#f3f6ff",
      muted: "#c2ccdd",
      accent: "#ffd6e7",
      good: "#4fd67f",
      bad: "#ff7ab0",
      panelBg: PANEL_BACKGROUND,
    },
  },
};

export function paletteVars(id: ColorBlindMode): Record<string, string> {
  const colors = (PALETTES[id] ?? PALETTES.default).colors;
  return {
    "--apex-fg": colors.fg,
    "--apex-muted": colors.muted,
    "--apex-accent": colors.accent,
    "--apex-good": colors.good,
    "--apex-bad": colors.bad,
  };
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal text. */
export const AA_NORMAL = 4.5;
