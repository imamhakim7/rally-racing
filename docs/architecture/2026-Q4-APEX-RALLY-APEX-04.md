# Epic architecture — `2026-Q4-APEX-RALLY-APEX-04` Best-in-Class UI/UX

Binding design for every ticket under this epic. If a ticket needs to diverge, it
updates this document first, then the code (SDD rule: spec → change → test → validate).

## Goal

Players reach a race in three actions, read the race at a glance, and the experience
feels premium and meets **WCAG AA** on desktop and mobile.

## Principles

1. **Canvas-independent overlay.** All UI is DOM/SVG layered over the WebGL canvas; it
   never lives inside the render loop's scene graph. This keeps text crisp at any DPI,
   makes the UI screen-reader accessible, and lets it be tested in a browser without GL.
2. **View projection, not state.** UI reads race/vehicle state and renders it. It never
   owns authoritative race state (that lives in `src/race`). Pure view-model modules hold
   the logic so it can be unit-tested headlessly (vitest runs with `environment: "node"`).
3. **Design tokens.** Type, colour, spacing, radius and safe-area insets come from CSS
   custom properties (`--apex-*`) so later tickets (menus #APEX-11, input #APEX-12) reuse
   one visual language instead of re-inventing it.
4. **Layout is resolution- and input-independent.** A responsive corner layout scales from
   a 320 px-wide phone to 4K. Interactive UI respects **reduced-motion** and colour is
   never the only carrier of meaning (WCAG AA: use sign + glyph + text alongside colour).
5. **Safe zones.** The central band of the viewport (the racing line) is kept free of HUD
   by anchoring elements to corners with bounded size. Non-occlusion is asserted in a
   browser (`docs/evidence/APEX-10-responsive.txt`).

## System shape

```
src/race/            race state machine (authoritative)  ──┐
src/physics          vehicle telemetry (speed …)          ──┤
src/stage            circuit + minimap path (data)        ──┤
                                                            ▼
                              src/race/hud-model.ts   (pure view model)
                                                            │
                              src/race/telemetry.ts   (telemetry port + harness)
                                                            │
                              src/race/hud.ts         (DOM/SVG overlay, tokens)
```

The HUD is a function of `(RaceController, HudTelemetry, StageWorld.minimap)`.

## Interfaces owned by this epic

```ts
interface HudTelemetry { speedKmh: number }                 // from physics (or harness)
type TelemetrySource = () => HudTelemetry

interface ReferenceSplit { checkpointId: string; time: number } // cumulative target time
interface StageDefinition { /* … */ referenceSplits?: ReferenceSplit[] }

interface HudState {                                         // pure, DOM-free
  phase: RacePhase
  speedText: string; timeText: string; positionText: string
  nextText: string
  split: { text: string; direction: "ahead" | "behind" | "even" } | null
  progress: { x: number; y: number } | null                  // normalised minimap dot
  srSummary: string; srKey: string
}
```

## Invariants

1. The overlay renders with `textContent` only — **never** `innerHTML` with dynamic data
   (XSS-safe by construction).
2. Split delta compares *actual cumulative* time to the *reference cumulative* time at the
   same gate: negative = ahead (green), positive = behind (red), with a sign and arrow
   glyph so meaning survives colour-blindness.
3. Live position is a projection (`elapsed / progressRatio` vs opponent times) and is
   `null` until at least one split exists — no dishonest "P1" on the start line.
4. The minimap dot is derived from race progress over the resolved circuit path; it never
   mutates the path.
5. The screen-reader summary updates on phase/checkpoint/position/coarse-time changes
   only (bounded cadence), never every animation frame.
6. Design tokens are declared once; tickets consume, never fork, the palette.

## Epic acceptance (inherited by tickets)

- Reach a race in ≤ 3 actions; read speed, time, split, position and minimap at a glance.
- Layout legible and non-overlapping from 320 px to 4K; no occlusion of the racing line at
  default settings.
- WCAG AA: contrast, non-colour-only signalling, reduced-motion, screen-reader summary.

## Ticket map

| Ticket | Contributes |
| --- | --- |
| #APEX-10 | Race HUD (speed, time, splits, position, minimap) — this epic's first slice |
| #APEX-11 | Menus, stage select, settings, first-run tutorial |
| #APEX-12 | Input abstraction + accessibility (gamepad, touch, WCAG AA) |
