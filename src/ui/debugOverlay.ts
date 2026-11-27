/**
 * On-screen debug overlay. It owns no DOM of its own — the caller passes the
 * element to write into — so it can be unit-tested with a stub and mounted next
 * to the canvas in `main.ts`.
 */

import { formatDebugHud, toDebugHud } from "../physics/debug";
import type { Surface } from "../physics/surface";
import type { VehicleTelemetry } from "../physics/vehicle";

export interface DebugOverlay {
  readonly element: HTMLElement;
  update(telemetry: VehicleTelemetry, surface: Surface): void;
  dispose(): void;
}

export function createDebugOverlay(element: HTMLElement): DebugOverlay {
  let lastText = "";
  return {
    element,
    update(telemetry, surface) {
      const text = formatDebugHud(toDebugHud(telemetry, surface));
      if (text !== lastText) {
        element.textContent = text;
        lastText = text;
      }
      element.setAttribute("data-surface", surface.id);
      element.setAttribute("data-drifting", telemetry.drifting ? "true" : "false");
    },
    dispose() {
      element.textContent = "";
      lastText = "";
    },
  };
}
