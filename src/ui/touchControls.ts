/**
 * On-screen touch controls (#APEX-12).
 *
 * Left: a steering pad (drag from centre → −1..1). Right: throttle, brake and
 * handbrake hold-buttons. Normalises pointer input into a `TouchPad` and reads as
 * a `VehicleInput` through the pure `touchPadToInput` mapping, so the same physics
 * command contract is used as keyboard/gamepad.
 */
import {
  NEUTRAL_TOUCH_PAD,
  steerFromOffset,
  touchPadToInput,
  type TouchPad,
} from "../input/touch";
import type { InputSource } from "../input/keyboard";

export interface TouchControlsHandle extends InputSource {
  readonly element: HTMLElement;
  setVisible(visible: boolean): void;
}

const STYLE = `
.apex-touch { position: fixed; inset: 0; z-index: 20; pointer-events: none; touch-action: none; }
.apex-touch[hidden] { display: none; }
.apex-touch__steer {
  position: absolute; left: max(12px, 4vw); bottom: max(12px, 5vh);
  width: clamp(96px, 26vw, 168px); height: clamp(96px, 26vw, 168px);
  border-radius: 50%; pointer-events: auto; touch-action: none;
  background: radial-gradient(circle at 50% 50%, rgba(127,208,255,.18), rgba(9,13,20,.6));
  border: 1px solid rgba(150,196,255,.4);
}
.apex-touch__knob {
  position: absolute; left: 50%; top: 50%; width: 44%; height: 44%;
  transform: translate(-50%, -50%); border-radius: 50%;
  background: rgba(127,208,255,.55); border: 1px solid rgba(231,238,247,.6);
}
.apex-touch__btns {
  position: absolute; right: max(12px, 4vw); bottom: max(12px, 5vh);
  display: flex; flex-direction: column; gap: 10px; align-items: flex-end; pointer-events: auto;
}
.apex-touch__btn {
  pointer-events: auto; touch-action: none; font: 700 15px/1 system-ui, sans-serif;
  color: #06121f; background: var(--apex-accent, #7fd0ff); border: 0; border-radius: 14px;
  padding: 16px 18px; min-width: 84px;
}
.apex-touch__btn--brake { background: var(--apex-bad, #ff9f7b); }
.apex-touch__btn--handbrake { background: var(--apex-good, #6ee7a0); }
.apex-touch__btn:active { filter: brightness(1.25); }
`;

export function createTouchControls(host: HTMLElement, doc: Document = document): TouchControlsHandle {
  const style = doc.createElement("style");
  style.textContent = STYLE;

  const root = doc.createElement("div");
  root.className = "apex-touch";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Touch driving controls");

  const pad = doc.createElement("div");
  pad.className = "apex-touch__steer";
  pad.setAttribute("role", "slider");
  pad.setAttribute("aria-label", "Steering");
  pad.setAttribute("aria-valuemin", "-1");
  pad.setAttribute("aria-valuemax", "1");
  pad.setAttribute("aria-valuenow", "0");
  const knob = doc.createElement("div");
  knob.className = "apex-touch__knob";
  pad.append(knob);

  const padState: TouchPad = { ...NEUTRAL_TOUCH_PAD };
  let padPointer: number | null = null;

  const syncPad = (): void => {
    pad.setAttribute("aria-valuenow", padState.steer.toFixed(2));
    knob.style.transform = `translate(calc(-50% + ${padState.steer * 30}%), -50%)`;
  };

  const updateFromPointer = (event: PointerEvent): void => {
    const rect = pad.getBoundingClientRect();
    const radius = rect.width / 2 || 1;
    padState.steer = steerFromOffset(event.clientX - (rect.left + rect.width / 2), radius);
    syncPad();
  };

  const onPadDown = (event: PointerEvent): void => {
    padPointer = event.pointerId;
    pad.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
    event.preventDefault();
  };
  const onPadMove = (event: PointerEvent): void => {
    if (padPointer !== event.pointerId) return;
    updateFromPointer(event);
  };
  const onPadUp = (event: PointerEvent): void => {
    if (padPointer !== event.pointerId) return;
    padPointer = null;
    padState.steer = 0;
    syncPad();
  };
  pad.addEventListener("pointerdown", onPadDown);
  pad.addEventListener("pointermove", onPadMove);
  pad.addEventListener("pointerup", onPadUp);
  pad.addEventListener("pointercancel", onPadUp);
  pad.addEventListener("lostpointercapture", onPadUp);

  const buttons: HTMLElement = doc.createElement("div");
  buttons.className = "apex-touch__btns";

  const makeButton = (
    label: string,
    className: string,
    set: (pressed: boolean) => void,
  ): HTMLButtonElement => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `apex-touch__btn ${className}`;
    button.textContent = label;
    const down = (event: PointerEvent): void => {
      button.setPointerCapture?.(event.pointerId);
      set(true);
      event.preventDefault();
    };
    const up = (): void => set(false);
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
    button.addEventListener("lostpointercapture", up);
    return button;
  };

  buttons.append(
    makeButton("Throttle", "apex-touch__btn--throttle", (pressed) => {
      padState.throttle = pressed ? 1 : 0;
    }),
    makeButton("Brake", "apex-touch__btn--brake", (pressed) => {
      padState.brake = pressed ? 1 : 0;
    }),
    makeButton("Handbrake", "apex-touch__btn--handbrake", (pressed) => {
      padState.handbrake = pressed;
    }),
  );

  root.append(style, pad, buttons);
  root.hidden = true;
  host.append(root);
  syncPad();

  return {
    element: root,
    setVisible(visible) {
      root.hidden = !visible;
    },
    read: () => touchPadToInput(padState),
    dispose() {
      padState.steer = 0;
      padState.throttle = 0;
      padState.brake = 0;
      padState.handbrake = false;
      root.remove();
    },
  };
}
