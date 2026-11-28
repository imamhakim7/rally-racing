/**
 * Speed motion-blur overlay (#APEX-12).
 *
 * A canvas-independent DOM layer that blurs the screen edges with
 * `backdrop-filter`. `setStrength` is driven by the region scene's camera motion
 * (`cameraEffects().blur`). The overlay is hidden entirely under
 * `html[data-motion="reduced"]`, so reduced motion disables it regardless of the
 * strength the scene reports — belt and braces with `cameraMotion` returning 0.
 */
export interface MotionBlurHandle {
  readonly element: HTMLElement;
  /** Blur strength in px (0 = off). */
  setStrength(px: number): void;
  dispose(): void;
}

const STYLE = `
.apex-motion-blur {
  position: fixed; inset: 0; z-index: 15; pointer-events: none;
  backdrop-filter: blur(var(--apex-motion-blur, 0px));
  -webkit-backdrop-filter: blur(var(--apex-motion-blur, 0px));
  -webkit-mask-image: radial-gradient(ellipse at center, transparent 45%, #000 100%);
  mask-image: radial-gradient(ellipse at center, transparent 45%, #000 100%);
}
html[data-motion="reduced"] .apex-motion-blur { display: none; }
`;

export function mountMotionBlur(host: HTMLElement, doc: Document = document): MotionBlurHandle {
  const style = doc.createElement("style");
  style.textContent = STYLE;
  const element = doc.createElement("div");
  element.className = "apex-motion-blur";
  element.setAttribute("aria-hidden", "true");
  host.append(style, element);

  return {
    element,
    setStrength(px) {
      const clamped = Number.isFinite(px) ? Math.min(8, Math.max(0, px)) : 0;
      element.style.setProperty("--apex-motion-blur", `${clamped.toFixed(2)}px`);
    },
    dispose() {
      style.remove();
      element.remove();
    },
  };
}
