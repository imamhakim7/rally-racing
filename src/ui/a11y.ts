/**
 * Settings → DOM accessibility projection (#APEX-12).
 *
 * `a11yAttributes` is pure: it turns the persisted accessibility settings (plus
 * the system reduced-motion flag) into the `data-*` attributes and CSS custom
 * properties the stylesheets consume. `applyA11y` is the thin DOM writer. Keeping
 * the projection pure makes the WCAG behaviour unit-testable headlessly.
 */
import { resolveMotionState, type MotionState } from "../engine/motion";
import type { GameSettings } from "../input/settings";
import { paletteVars } from "./palette";

export type { MotionState };

export interface A11yProjection {
  /** `data-*` attributes to set on the root (e.g. `motion` -> `data-motion`). */
  dataset: Record<string, string>;
  /** CSS custom properties (palette colours, text scale) to set on the root. */
  cssVars: Record<string, string>;
}

/** Root element contract: enough for `document.documentElement` and for a fake. */
export interface A11yRoot {
  dataset: Record<string, string>;
  style: { setProperty(name: string, value: string): void };
}

export interface MediaQueryListLike {
  matches: boolean;
}

/** Read the OS reduced-motion preference through an injected port (defaults false). */
export function systemPrefersReducedMotion(read: () => MediaQueryListLike | null): boolean {
  try {
    return read()?.matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Project settings into the root attributes:
 * - `data-motion="full" | "reduced"` (drives CSS motion gating)
 * - `data-palette="<mode>"` (selects the palette block)
 * - `data-text-scale="<1..2>"` and `--apex-text-scale` (text scaling)
 * - palette colour custom properties
 */
export function a11yAttributes(
  settings: GameSettings,
  systemReducedMotion: boolean,
): A11yProjection {
  const { reducedMotion, colorBlindMode, textScale } = settings.accessibility;
  const motion = resolveMotionState(reducedMotion, systemReducedMotion);
  return {
    dataset: {
      motion,
      palette: colorBlindMode,
      textScale: textScale.toFixed(2),
    },
    cssVars: {
      "--apex-text-scale": String(textScale),
      ...paletteVars(colorBlindMode),
    },
  };
}

/** Write a projection onto a root element (idempotent). */
export function applyA11y(root: A11yRoot, projection: A11yProjection): void {
  for (const [key, value] of Object.entries(projection.dataset)) {
    root.dataset[key] = value;
  }
  for (const [name, value] of Object.entries(projection.cssVars)) {
    root.style.setProperty(name, value);
  }
}

/** Convenience: resolve + apply against a live document. */
export function applySettingsToDocument(
  doc: Document,
  settings: GameSettings,
  systemReducedMotion: boolean,
): void {
  applyA11y(doc.documentElement as unknown as A11yRoot, a11yAttributes(settings, systemReducedMotion));
}
