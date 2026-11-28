# APEX-12 — Input abstraction and accessibility (gamepad, touch, WCAG AA)

Epic: `2026-Q4-APEX-RALLY-APEX-04` — Best-in-Class UI/UX (see the binding
[epic architecture](../architecture/2026-Q4-APEX-RALLY-APEX-04.md)).

Depends on: **#APEX-10** (HUD + design tokens, merged) for the visual language and
the `--apex-*` token set; **#APEX-2** (`VehicleInput`) as the command contract every
source resolves to.

Sequencing note (lead): #APEX-11 (menus/settings) and #APEX-12 both touch the boot
wiring in `src/main.ts` and both want a settings store. #APEX-11 was still in the
backlog, so this ticket **owns the shared settings module** (`src/input/settings.ts`)
and #APEX-11 consumes it rather than standing up a second one. #APEX-11 must rebase
onto this branch (integration seam documented below).

## Problem

The game can only be driven with the hard-coded WASD/arrow/space keyboard mapping:
there is no gamepad or touch input, controls cannot be remapped, and accessibility
was never specified — no colour-blind-safe palette, no user-controlled reduced
motion for the new camera effects, no text scaling, and no defined focus model. A
player on a controller or phone cannot play, a player who cannot use colour gets no
redundant cue, and a player who needs larger text or less motion cannot get it.

## Goal

One **input abstraction** where keyboard, gamepad and touch all resolve to the same
`VehicleInput`, with **remappable controls and conflict detection**; and an
**accessibility layer** (WCAG AA) providing colour-blind-safe palettes with
non-colour redundancy, a reduced-motion mode that disables camera shake and motion
blur, text scaling to 200 % without clipping, and a logical, fully keyboard-reachable
focus order.

## Non-goals

- In-world player car / camera rig integration (#APEX-16); the abstraction is wired to
  the existing telemetry harness via the same `input?: () => VehicleInput` port so it
  swaps in with one line when integration lands.
- Full menu/onboarding flow and its visual design (#APEX-11); this ticket ships a
  functional settings surface and the shared persistence it will adopt.
- Gamepad rumble, gyro, or per-device button-glyph iconography (Xbox/PS/Nintendo).
- Audio (co-driver) alternatives — that is #APEX-6.

## Architecture (epic binding)

Follows the epic principles: **canvas-independent DOM overlay**, **pure view
projection**, **one design-token language**, **input-independent layout**, and
**colour never the sole signal**. The new logic is pure and headless; platform APIs
(keyboard events, `navigator.getGamepads`, `pointer*`, `localStorage`,
`matchMedia`) sit behind narrow ports so the core runs in Vitest
(`environment: "node"`).

### System shape

```
             ┌─────────────────────── src/input/bindings.ts (pure) ──────────────┐
             │  Bindings: InputAction -> ControlBinding[]  · conflicts() · assign │
             └───────────────────────────────┬───────────────────────────────────┘
                                              │  (one bindings table)
   keyboard events ── src/input/keyboard.ts ──┤
   navigator.getGamepads ─ src/input/gamepad.ts ─┤──▶ src/input/manager.ts ──▶ VehicleInput
   pointer/touch ─── src/input/touch.ts ──────┘         (merge + active device)
   pure mapping ─────┘                                   ▲
                                                         │ input?: () => VehicleInput
   src/input/settings.ts (persist) ──▶ src/ui/a11y.ts ──▶ src/race/telemetry.ts (harness)
        │                                  │
        │                                  ├─▶ src/ui/palette.ts (CSS vars, contrast-checked)
        │                                  ├─▶ src/engine/motion.ts (shake/blur policy)
        │                                  └─▶ src/ui/settingsPanel.ts (DOM, focus order)
        └─▶ src/ui/touchControls.ts (on-screen pad, DOM)
```

### Modules

| Module | Responsibility |
| --- | --- |
| `src/input/actions.ts` | **New.** `InputAction` vocabulary, `ActionValues` (0..1 per action), `actionsToVehicleInput`. |
| `src/input/bindings.ts` | **New.** `ControlBinding`, `Bindings`, `DEFAULT_BINDINGS`, `normalizeBindings`, `conflicts`, `assignBinding`, label maps. |
| `src/input/keyboard.ts` | Binding-aware `mapKeys(pressed, bindings?)` (defaults preserve current behaviour); `createKeyboardInput(target, bindings?)`. |
| `src/input/gamepad.ts` | **New.** `GamepadState` + `gamepadToActions` (deadzone, buttons + signed axis). |
| `src/input/touch.ts` | **New.** Pure `TouchPad` → `VehicleInput` (`touchPadToInput`). |
| `src/input/manager.ts` | **New.** `createInputManager` merges keyboard/gamepad/touch into one `VehicleInput`, reports active device, owns live bindings. |
| `src/input/settings.ts` | **New.** Shared `GameSettings`, `normalizeSettings`, memory + `localStorage` stores (versioned key). |
| `src/input/index.ts` | **New.** Barrel. |
| `src/ui/palette.ts` | **New.** Colour-blind-safe palettes as CSS vars + `contrastRatio` (AA-checked in tests). |
| `src/ui/a11y.ts` | **New.** `resolveMotion`, `a11yAttributes`, `applyA11y` — settings → `data-*` + `--apex-*` on the root. |
| `src/engine/motion.ts` | **New.** `MotionPolicy`, `cameraMotion` (shake/blur; both 0 when reduced), `shakeOffset`. |
| `src/scenes/aiRaceScene.ts` | Accept a `MotionPolicy`; apply gated camera shake in `applyCamera`. |
| `src/ui/touchControls.ts` | **New.** On-screen steering stick + throttle/brake/handbrake buttons → `InputSource`. |
| `src/ui/settingsPanel.ts` | **New.** Keyboard-reachable settings (motion, palette, text size, remap) with conflict messages. |
| `src/main.ts` | Load settings, apply a11y, build the input manager, mount touch + settings UI, pass motion to the region scene. |

### Interfaces

```ts
type InputAction = "throttle" | "brake" | "steerLeft" | "steerRight" | "handbrake";
type ActionValues = Record<InputAction, number>;            // each 0..1

interface ControlBinding { device: "keyboard" | "gamepad"; kind: "button" | "axis"; code: string }
type Bindings = Record<InputAction, ControlBinding[]>;
interface Conflict { binding: ControlBinding; actions: InputAction[] }   // >1 action shares it

function actionsToVehicleInput(values: ActionValues): VehicleInput;      // steer = right - left
function normalizeBindings(raw: unknown): Bindings;                     // never throws
function conflicts(bindings: Bindings): Conflict[];                     // axis bindings exempt
function bindingOwners(bindings: Bindings, binding: ControlBinding, except?: InputAction): InputAction[];
function assignBinding(bindings: Bindings, action: InputAction, binding: ControlBinding): Bindings;
function mapKeys(pressed: ReadonlySet<string>, bindings?: Bindings): VehicleInput;

interface GamepadState { connected: boolean; buttons: { pressed: boolean; value: number }[]; axes: number[] }
function gamepadToActions(state: GamepadState | null, bindings?: Bindings, opts?: { deadzone?: number }): ActionValues;

interface TouchPad { steer: number; throttle: number; brake: number; handbrake: boolean }
function touchPadToInput(pad: TouchPad): VehicleInput;

interface InputManager extends InputSource {
  readonly activeDevice: "keyboard" | "gamepad" | "touch" | "none";
  getBindings(): Bindings;
  setBindings(bindings: Bindings): void;
}
function createInputManager(opts?: {
  bindings?: Bindings;
  keyboardTarget?: KeyboardTarget | null;
  gamepadState?: () => GamepadState | null;   // default: navigator.getGamepads()
  touch?: InputSource | null;
  deadzone?: number;
}): InputManager;

type ReducedMotionPreference = "auto" | "on" | "off";
type ColorBlindMode = "default" | "deuteranopia" | "protanopia" | "tritanopia";
interface AccessibilitySettings { reducedMotion: ReducedMotionPreference; colorBlindMode: ColorBlindMode; textScale: number }
interface InputSettings { bindings: Bindings; deadzone: number }
interface GameSettings { version: number; input: InputSettings; accessibility: AccessibilitySettings }
function normalizeSettings(raw: unknown): GameSettings;      // clamps scale 1..2, unknown enum -> default
function createLocalStorageStore(storage: StorageLike): SettingsStore;

type MotionState = "full" | "reduced";
function resolveMotion(pref: ReducedMotionPreference, systemReducedMotion: boolean): MotionState;
function a11yAttributes(s: GameSettings, systemReducedMotion: boolean): { dataset: Record<string,string>; cssVars: Record<string,string> };
function cameraMotion(policy: MotionPolicy, speedRatio: number): { shake: number; blur: number };
```

### Invariants

1. Every source resolves to the same `VehicleInput`; the merged command is neutral
   when no source is active (the car never drives itself after a focus loss).
2. A binding maps to exactly one action — except a signed gamepad **axis**, which may
   legitimately serve `steerLeft` + `steerRight`; `conflicts()` flags every other share.
3. `normalizeBindings`/`normalizeSettings` never throw on corrupt persisted data; they
   fall back to defaults so a bad `localStorage` value cannot brick the boot.
4. `cameraMotion` returns `{ shake: 0, blur: 0 }` whenever `policy.reduced` is true —
   reduced motion is enforced in the policy, not left to CSS only.
5. Palettes are applied as CSS custom properties on one root; contrast of every
   text/foreground pair against its panel background meets **WCAG AA (≥ 4.5:1)**.
6. Meaning is never colour-only: a split carries a sign + arrow glyph (existing), the
   player's result row is bold + labelled, and palette swaps never remove the glyph.
7. Text scaling multiplies a single root custom property, and every HUD/settings
   dimension is relative (`em`/`rem`/`clamp()`), so 200 % does not clip.
8. All interactive controls are native focusable elements in DOM order; every one is
   reachable and operable by keyboard alone.

### Edge cases

- `navigator.getGamepads` absent or throws → gamepad source is neutral; keyboard/touch
  still work.
- Gamepad disconnect mid-race → its contribution drops to neutral on the next frame.
- Deadzone: axis within `keepAlive` band uses no hysteresis jump; values below the
  deadzone read as 0.
- Rebind to a code already used by another action → the control is **reassigned** to
  the new action (the previous owner loses it, so it never double-fires while driving)
  and the panel reports a conflict notice naming the action it came from. A persisted
  table that still shares a control (hand-edited `localStorage`) is flagged by
  `conflicts()` on load.
- `localStorage` unavailable (private mode) → memory store; settings apply for the
  session.
- `prefers-reduced-motion: reduce` with preference `auto` → reduced; an explicit
  `off` overrides the system (accessibility opt-out is allowed but visible in UI).

## Acceptance criteria (Given/When/Then)

- **AC1 — three inputs drive the car.** Given a keyboard, an injected gamepad state
  and an injected touch pad, Then each maps to a `VehicleInput` that accelerates,
  brakes and steers; Given none are active, Then the command is neutral.
- **AC2 — remap + conflict detection.** Given the controls screen, When the user
  rebinds an action to a control already bound to a different action, Then the binding
  is applied and a conflict is reported for that control; Given a conflict-free table,
  Then `conflicts()` is empty.
- **AC3 — colour is never the sole signal.** Given any palette including the
  colour-blind ones, Then the split cue keeps its sign + glyph and the results "me" row
  keeps its label, and every foreground/background pair still meets AA contrast.
- **AC4 — reduced motion disables shake and blur.** Given `reducedMotion` on (or
  `auto` + system reduce), Then `cameraMotion` returns zero shake and zero blur and the
  region camera applies no shake; Given full motion, Then shake/blur scale with speed.
- **AC5 — text scales to 200 % without clipping.** Given `textScale` 1.0 → 2.0, Then
  the root text scale property changes, layout dimensions are relative, and no HUD or
  settings element clips at 200 %.
- **AC6 — logical focus + keyboard reachability.** Given the settings surface, Then
  every control is a focusable native element in a logical DOM order and can be
  operated by keyboard alone (tab, arrows, enter/space).

## How to test

- **Unit (Vitest, headless):** `tests/input-bindings.test.ts` (map, conflicts,
  assign, normalize), `tests/input-gamepad.test.ts`, `tests/input-touch.test.ts`,
  `tests/input-manager.test.ts`, `tests/input-settings.test.ts`,
  `tests/a11y.test.ts` (motion resolve, attributes, palette contrast),
  `tests/motion.test.ts` (zero under reduced).
- **Tooling evidence:** a browser script measures the settings surface's focus order,
  the 200 % text-scaling non-clip, and the reduced-motion attribute wiring; screenshots
  captured to `docs/evidence/`.
- **Gates:** `bun run typecheck` and `bun run test` green; evidence attached.

## Evidence plan

- `docs/evidence/APEX-12-tests.txt`, `APEX-12-typecheck.txt`.
- `docs/evidence/APEX-12-a11y.txt` (focus order, 200 % non-clip, reduced-motion attrs,
  palette contrast report).
- `docs/evidence/APEX-12-input.txt` (per-device mapping samples + conflict report).
