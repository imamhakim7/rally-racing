/**
 * Settings surface (#APEX-12): motion, colour vision, text size and control
 * remapping with conflict detection.
 *
 * Every control is a native focusable element in a logical DOM order, so the
 * surface is fully keyboard-operable. The pure projection (`a11y.ts`) and the
 * binding logic (`bindings.ts`) hold the substance; this module is the thin DOM
 * shell that emits a new `GameSettings` through `onChange`.
 */
import { ACTION_LABELS, INPUT_ACTIONS, type InputAction } from "../input/actions";
import {
  assignBinding,
  bindingLabel,
  bindingOwners,
  conflicts,
  defaultBindings,
  type Bindings,
  type ControlBinding,
} from "../input/bindings";
import {
  COLOR_BLIND_MODES,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  REDUCED_MOTION_PREFERENCES,
  type ColorBlindMode,
  type GameSettings,
  type ReducedMotionPreference,
} from "../input/settings";
import { PALETTES } from "./palette";

export interface SettingsPanelOptions {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  doc?: Document;
}

export interface SettingsPanelHandle {
  readonly element: HTMLElement;
  update(settings: GameSettings): void;
  dispose(): void;
}

const STYLE = `
.apex-settings-root {
  position: fixed; left: 50%; transform: translateX(-50%);
  top: max(8px, env(safe-area-inset-top, 8px)); z-index: 30;
  font: clamp(12px, 0.7rem + 0.3vw, 16px)/1.5 system-ui, -apple-system, sans-serif;
  color: var(--apex-fg, #eaf2ff);
}
.apex-settings__toggle {
  pointer-events: auto; cursor: pointer; font: inherit; font-weight: 700;
  color: #06121f; background: var(--apex-accent, #7fd0ff); border: 0; border-radius: 8px;
  padding: 8px 14px; min-height: 40px;
}
.apex-settings__toggle:focus-visible { outline: 3px solid var(--apex-good, #6ee7a0); outline-offset: 2px; }
.apex-settings {
  pointer-events: auto; margin-top: 8px; width: min(92vw, 460px); max-height: 78vh; overflow: auto;
  background: rgba(9, 13, 20, .95); border: 1px solid rgba(150, 196, 255, .4);
  border-radius: 12px; padding: 14px 16px;
  font-size: calc(1em * var(--apex-text-scale, 1));
}
.apex-settings[hidden] { display: none; }
.apex-settings h2 { margin: 0 0 8px; font-size: 1.2em; }
.apex-settings label { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 8px 0; }
.apex-settings select, .apex-settings input[type="range"] { font: inherit; max-width: 60%; }
.apex-settings :focus-visible { outline: 3px solid var(--apex-good, #6ee7a0); outline-offset: 2px; }
.apex-settings fieldset { border: 1px solid rgba(150, 196, 255, .25); border-radius: 8px; margin: 12px 0 0; padding: 8px 10px; }
.apex-settings legend { padding: 0 6px; color: var(--apex-muted, #a9bdd6); }
.apex-bind-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
.apex-bind-row__name { flex: 0 0 42%; }
.apex-bind {
  font: inherit; cursor: pointer; color: var(--apex-fg, #eaf2ff);
  background: #161b24; border: 1px solid rgba(150,196,255,.35); border-radius: 6px; padding: 4px 10px;
}
.apex-bind.is-capturing { border-color: var(--apex-good, #6ee7a0); }
.apex-bind--pad { opacity: .75; cursor: default; }
.apex-settings__conflict { margin: 8px 0 0; color: var(--apex-bad, #ff9f7b); min-height: 1.4em; }
.apex-settings__actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.apex-settings__actions button { font: inherit; cursor: pointer; padding: 8px 12px; min-height: 40px; border-radius: 8px; border: 1px solid rgba(150,196,255,.4); background: transparent; color: #cfe4ff; }
.apex-sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function optionList(
  doc: Document,
  values: readonly string[],
  labels: (value: string) => string,
): HTMLOptionElement[] {
  return values.map((value) => {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = labels(value);
    return option;
  });
}

export function mountSettingsPanel(
  host: HTMLElement,
  options: SettingsPanelOptions,
): SettingsPanelHandle {
  const doc = options.doc ?? host.ownerDocument ?? document;
  let current = options.settings;
  let capture: { action: InputAction; button: HTMLButtonElement } | null = null;
  let notice = "";

  const style = doc.createElement("style");
  style.textContent = STYLE;

  const root = el(doc, "div", "apex-settings-root");
  const panelId = "apex-settings-panel";
  const toggle = el(doc, "button", "apex-settings__toggle", "Settings");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);

  const panel = el(doc, "section", "apex-settings");
  panel.id = panelId;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Settings");
  panel.hidden = true;

  const heading = el(doc, "h2", undefined, "Settings");

  // Accessibility fields ------------------------------------------------------
  const motionLabel = el(doc, "label");
  motionLabel.append(el(doc, "span", undefined, "Reduced motion"));
  const motionSelect = doc.createElement("select");
  motionSelect.append(
    ...optionList(doc, REDUCED_MOTION_PREFERENCES, (v) =>
      v === "auto" ? "System default" : v === "on" ? "On" : "Off",
    ),
  );
  motionLabel.append(motionSelect);

  const paletteLabel = el(doc, "label");
  paletteLabel.append(el(doc, "span", undefined, "Colour vision"));
  const paletteSelect = doc.createElement("select");
  paletteSelect.append(...optionList(doc, COLOR_BLIND_MODES, (v) => PALETTES[v as ColorBlindMode].label));
  paletteLabel.append(paletteSelect);

  const scaleLabel = el(doc, "label");
  const scaleText = el(doc, "span", undefined, "Text size");
  const scaleInput = doc.createElement("input");
  scaleInput.type = "range";
  scaleInput.min = String(MIN_TEXT_SCALE * 100);
  scaleInput.max = String(MAX_TEXT_SCALE * 100);
  scaleInput.step = "10";
  const scaleOutput = el(doc, "output", undefined, "100%");
  scaleLabel.append(scaleText, scaleInput, scaleOutput);

  // Controls ------------------------------------------------------------------
  const controlsFieldset = el(doc, "fieldset");
  controlsFieldset.append(el(doc, "legend", undefined, "Controls"));
  const controlsHost = el(doc, "div");
  const conflictNode = el(doc, "p", "apex-settings__conflict");
  conflictNode.setAttribute("role", "status");
  conflictNode.setAttribute("aria-live", "polite");
  controlsFieldset.append(controlsHost, conflictNode);

  const actions = el(doc, "div", "apex-settings__actions");
  const resetButton = el(doc, "button", undefined, "Reset controls");
  resetButton.type = "button";
  const closeButton = el(doc, "button", undefined, "Close");
  closeButton.type = "button";
  actions.append(resetButton, closeButton);

  const srNote = el(
    doc,
    "p",
    "apex-sr-only",
    "Tab moves through settings in order. Activate a control's key button, then press the key to bind it. Escape closes the panel.",
  );

  panel.append(
    heading,
    motionLabel,
    paletteLabel,
    scaleLabel,
    controlsFieldset,
    actions,
    srNote,
  );
  root.append(style, toggle, panel);
  host.append(root);

  // ---- behaviour -----------------------------------------------------------
  const notify = (next: GameSettings): void => {
    current = next;
    options.onChange(next);
    sync();
  };

  const renderControls = (): void => {
    controlsHost.replaceChildren();
    for (const action of INPUT_ACTIONS) {
      const row = el(doc, "div", "apex-bind-row");
      row.append(el(doc, "span", "apex-bind-row__name", ACTION_LABELS[action]));
      for (const binding of current.input.bindings[action]) {
        if (binding.device === "keyboard") {
          const button = el(doc, "button", "apex-bind", bindingLabel(binding));
          button.type = "button";
          button.setAttribute("aria-label", `Rebind ${ACTION_LABELS[action]} (currently ${bindingLabel(binding)})`);
          button.addEventListener("click", () => beginCapture(action, button));
          row.append(button);
        } else {
          const chip = el(doc, "span", "apex-bind apex-bind--pad", bindingLabel(binding));
          chip.setAttribute("aria-hidden", "true");
          row.append(chip);
        }
      }
      controlsHost.append(row);
    }
  };

  const renderConflicts = (): void => {
    const list = conflicts(current.input.bindings);
    if (list.length > 0) {
      conflictNode.setAttribute("data-conflicts", String(list.length));
      conflictNode.textContent = list
        .map((c) => `${bindingLabel(c.binding)} is bound to ${c.actions.map((a) => ACTION_LABELS[a]).join(" and ")}.`)
        .join(" ");
      return;
    }
    if (notice) {
      conflictNode.setAttribute("data-conflicts", "1");
      conflictNode.textContent = notice;
      return;
    }
    conflictNode.textContent = "";
    conflictNode.setAttribute("data-conflicts", "0");
  };

  const sync = (): void => {
    motionSelect.value = current.accessibility.reducedMotion;
    paletteSelect.value = current.accessibility.colorBlindMode;
    scaleInput.value = String(Math.round(current.accessibility.textScale * 100));
    scaleOutput.textContent = `${Math.round(current.accessibility.textScale * 100)}%`;
    renderControls();
    renderConflicts();
  };

  const endCapture = (): void => {
    if (!capture) return;
    doc.removeEventListener("keydown", onCaptureKey, true);
    capture.button.classList.remove("is-capturing");
    capture = null;
    renderControls();
  };

  function onCaptureKey(event: KeyboardEvent): void {
    if (!capture) return;
    event.preventDefault();
    event.stopPropagation();
    const { action } = capture;
    endCapture();
    if (event.key === "Escape") return;
    const binding: ControlBinding = { device: "keyboard", kind: "button", code: event.code };
    const owners = bindingOwners(current.input.bindings, binding, action);
    notice =
      owners.length > 0
        ? `Conflict resolved: ${bindingLabel(binding)} was reassigned to ${ACTION_LABELS[action]} from ${owners
            .map((a) => ACTION_LABELS[a])
            .join(", ")}.`
        : "";
    const nextBindings: Bindings = assignBinding(current.input.bindings, action, binding);
    notify({ ...current, input: { ...current.input, bindings: nextBindings } });
  }

  const beginCapture = (action: InputAction, button: HTMLButtonElement): void => {
    endCapture();
    capture = { action, button };
    button.textContent = "Press a key…";
    button.classList.add("is-capturing");
    doc.addEventListener("keydown", onCaptureKey, true);
  };

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      motionSelect.focus();
    } else {
      endCapture();
      toggle.focus();
    }
  };

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape" && !capture) setOpen(false);
  });

  motionSelect.addEventListener("change", () =>
    notify({
      ...current,
      accessibility: {
        ...current.accessibility,
        reducedMotion: motionSelect.value as ReducedMotionPreference,
      },
    }),
  );
  paletteSelect.addEventListener("change", () =>
    notify({
      ...current,
      accessibility: { ...current.accessibility, colorBlindMode: paletteSelect.value as ColorBlindMode },
    }),
  );
  scaleInput.addEventListener("input", () =>
    notify({
      ...current,
      accessibility: {
        ...current.accessibility,
        textScale: Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, Number(scaleInput.value) / 100)),
      },
    }),
  );
  resetButton.addEventListener("click", () => {
    notice = "";
    notify({ ...current, input: { ...current.input, bindings: defaultBindings() } });
  });

  sync();

  return {
    element: root,
    update(next) {
      current = next;
      sync();
    },
    dispose() {
      endCapture();
      root.remove();
    },
  };
}
