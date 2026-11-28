/**
 * Remappable control bindings and conflict detection (#APEX-12).
 *
 * A binding is a physical control: a keyboard code, a gamepad button index, or a
 * gamepad axis index. A binding maps to *one* action — with one deliberate
 * exception: a signed gamepad **axis** may serve both `steerLeft` and
 * `steerRight` (its sign selects the direction), so axis bindings are exempt from
 * conflict detection. Everything else is a conflict.
 */
import { INPUT_ACTIONS, type InputAction } from "./actions";

export type InputDevice = "keyboard" | "gamepad";
export type BindingKind = "button" | "axis";

export interface ControlBinding {
  device: InputDevice;
  kind: BindingKind;
  /** Keyboard `KeyboardEvent.code`, gamepad button index, or axis index (as string). */
  code: string;
}

export type Bindings = Record<InputAction, ControlBinding[]>;

/** A fixed table, or a getter so live remaps are picked up without recreation. */
export type BindingsLike = Bindings | (() => Bindings);

export interface Conflict {
  binding: ControlBinding;
  /** The two or more actions that share the binding. */
  actions: InputAction[];
}

function keyboard(code: string): ControlBinding {
  return { device: "keyboard", kind: "button", code };
}

function gamepadButton(code: string): ControlBinding {
  return { device: "gamepad", kind: "button", code };
}

function gamepadAxis(code: string): ControlBinding {
  return { device: "gamepad", kind: "axis", code };
}

/**
 * Sensible defaults: WASD + arrows (this is exactly what #APEX-10 shipped),
 * plus a standard-mapping gamepad (RT/A accelerate, LT/B brake, left-stick steer,
 * X handbrake). An axis bound to both steer directions is intentional.
 */
export const DEFAULT_BINDINGS: Bindings = {
  throttle: [keyboard("KeyW"), keyboard("ArrowUp"), gamepadButton("7"), gamepadButton("0")],
  brake: [keyboard("KeyS"), keyboard("ArrowDown"), gamepadButton("6"), gamepadButton("1")],
  steerLeft: [keyboard("KeyA"), keyboard("ArrowLeft"), gamepadAxis("0")],
  steerRight: [keyboard("KeyD"), keyboard("ArrowRight"), gamepadAxis("0")],
  handbrake: [keyboard("Space"), gamepadButton("2")],
};

/** Gamepad button/axis labels for a standard-mapping controller. */
const GAMEPAD_BUTTON_NAMES: Record<string, string> = {
  "0": "A / Cross",
  "1": "B / Circle",
  "2": "X / Square",
  "3": "Y / Triangle",
  "4": "LB / L1",
  "5": "RB / R1",
  "6": "LT / L2",
  "7": "RT / R2",
  "8": "Back / Share",
  "9": "Start / Options",
  "10": "D-pad up",
  "11": "D-pad down",
  "12": "D-pad left",
  "13": "D-pad right",
};

export function isAxisBinding(binding: ControlBinding): boolean {
  return binding.kind === "axis";
}

/** Identity used to compare/dedupe bindings. */
export function bindingKey(binding: ControlBinding): string {
  return `${binding.device}:${binding.kind}:${binding.code}`;
}

/** Human-readable label for a single binding. */
export function bindingLabel(binding: ControlBinding): string {
  if (binding.device === "keyboard") {
    return binding.code.replace(/^Key/, "").replace(/^Digit/, "");
  }
  if (binding.kind === "axis") {
    return `Stick ${binding.code}`;
  }
  return GAMEPAD_BUTTON_NAMES[binding.code] ?? `Button ${binding.code}`;
}

function isControlBinding(value: unknown): value is ControlBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.device === "keyboard" || v.device === "gamepad") &&
    (v.kind === "button" || v.kind === "axis") &&
    typeof v.code === "string" &&
    v.code.length > 0
  );
}

function dedupe(list: ControlBinding[]): ControlBinding[] {
  const seen = new Set<string>();
  const out: ControlBinding[] = [];
  for (const binding of list) {
    const key = bindingKey(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(binding);
  }
  return out;
}

function cloneBindings(bindings: Bindings): Bindings {
  return {
    throttle: [...bindings.throttle],
    brake: [...bindings.brake],
    steerLeft: [...bindings.steerLeft],
    steerRight: [...bindings.steerRight],
    handbrake: [...bindings.handbrake],
  };
}

/**
 * Coerce arbitrary (possibly corrupt, persisted) data into a valid `Bindings`.
 * Never throws: an invalid or empty action falls back to its defaults so the car
 * is always drivable.
 */
export function normalizeBindings(raw: unknown): Bindings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = {} as Bindings;
  for (const action of INPUT_ACTIONS) {
    const value = source[action];
    const list = Array.isArray(value) ? value.filter(isControlBinding) : [];
    const deduped = dedupe(list);
    out[action] = deduped.length > 0 ? deduped : [...DEFAULT_BINDINGS[action]];
  }
  return out;
}

export function bindingsEqual(a: Bindings, b: Bindings): boolean {
  return INPUT_ACTIONS.every((action) => {
    const left = a[action];
    const right = b[action];
    if (left.length !== right.length) return false;
    return left.every((binding, i) => bindingKey(binding) === bindingKey(right[i]!));
  });
}

/** All bindings currently shared by more than one action (axis bindings exempt). */
export function conflicts(bindings: Bindings): Conflict[] {
  const owners = new Map<string, { binding: ControlBinding; actions: InputAction[] }>();
  for (const action of INPUT_ACTIONS) {
    for (const binding of bindings[action]) {
      if (isAxisBinding(binding)) continue; // signed axis legitimately steers both ways
      const key = bindingKey(binding);
      const entry = owners.get(key);
      if (entry) {
        if (!entry.actions.includes(action)) entry.actions.push(action);
      } else {
        owners.set(key, { binding, actions: [action] });
      }
    }
  }
  const out: Conflict[] = [];
  for (const entry of owners.values()) {
    if (entry.actions.length > 1) {
      out.push({ binding: entry.binding, actions: [...entry.actions].sort() });
    }
  }
  return out;
}

export function hasConflicts(bindings: Bindings): boolean {
  return conflicts(bindings).length > 0;
}

/**
 * Actions that currently own `binding` (excluding `except`). Used by the rebind
 * flow to report a conflict when a control is taken from another action.
 */
export function bindingOwners(
  bindings: Bindings,
  binding: ControlBinding,
  except?: InputAction,
): InputAction[] {
  const key = bindingKey(binding);
  return INPUT_ACTIONS.filter(
    (action) => action !== except && bindings[action].some((b) => bindingKey(b) === key),
  );
}

/**
 * Bind `binding` to `action`: it is removed from every other action (a binding
 * owns one action) and added to `action`. Existing bindings on `action` are kept.
 * Returns a fresh table — callers never mutate shared state.
 */
export function assignBinding(
  bindings: Bindings,
  action: InputAction,
  binding: ControlBinding,
): Bindings {
  const next = cloneBindings(bindings);
  const key = bindingKey(binding);
  for (const other of INPUT_ACTIONS) {
    next[other] = next[other].filter((b) => bindingKey(b) !== key);
  }
  next[action] = dedupe([...next[action], binding]);
  return next;
}

/** Remove a binding from an action; an action is never left empty (keeps default). */
export function removeBinding(
  bindings: Bindings,
  action: InputAction,
  binding: ControlBinding,
): Bindings {
  const next = cloneBindings(bindings);
  const key = bindingKey(binding);
  const remaining = next[action].filter((b) => bindingKey(b) !== key);
  next[action] = remaining.length > 0 ? remaining : [...DEFAULT_BINDINGS[action]];
  return next;
}

export function defaultBindings(): Bindings {
  return cloneBindings(DEFAULT_BINDINGS);
}
