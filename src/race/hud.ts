import { buildHudState, buildPaceNoteHud, type HudTelemetry } from "./hud-model";
import { formatTime } from "./results";
import type { PaceNoteView } from "./pace-notes";
import type { RaceController } from "./race";

export interface RaceHudHandlers {
  onStart: () => void;
  onRestart: () => void;
  onQuit: () => void;
  /** Simulated gate crossing from the keyboard harness (until #APEX-16 lands). */
  onCrossGate: (gateId: string) => void;
}

/** Resolved minimap path (normalised 0..1) as supplied by `StageWorld`. */
export interface HudMinimap {
  points: { x: number; y: number }[];
  /** SVG path `d` in the same normalised space. */
  d: string;
}

const STYLE = `
.apex-hud, .apex-hud * { box-sizing: border-box; }
.apex-hud {
  --apex-bg: rgba(9, 13, 20, .86);
  --apex-border: rgba(150, 196, 255, .25);
  --apex-fg: #eaf2ff;
  --apex-muted: #a9bdd6;
  --apex-accent: #7fd0ff;
  --apex-good: #6ee7a0;
  --apex-bad: #ff8f6b;
  --apex-gap: clamp(8px, 1.4vw, 18px);
  --apex-radius: clamp(8px, 1vw, 14px);
  --apex-safe: clamp(8px, 1.6vw, 28px);
  --apex-font: ui-monospace, SFMono-Regular, Menlo, monospace;
  position: fixed; inset: 0; pointer-events: none;
  font: clamp(12px, 0.8vw + 6px, 28px)/1.4 var(--apex-font);
  color: var(--apex-fg);
}
.apex-panel {
  pointer-events: auto; position: absolute; background: var(--apex-bg);
  border: 1px solid var(--apex-border); border-radius: var(--apex-radius);
  padding: clamp(8px, 1vw, 18px) clamp(10px, 1.2vw, 22px);
  backdrop-filter: blur(3px);
}
.apex-select { left: 50%; top: 42%; transform: translate(-50%,-50%); text-align: center; width: min(86vw, 360px); }
.apex-title { font-size: 1.6em; letter-spacing: .12em; margin: 0 0 4px; }
.apex-sub { color: var(--apex-muted); margin: 0 0 16px; }
.apex-btn {
  pointer-events: auto; cursor: pointer; font: inherit; color: #06121f; background: var(--apex-accent);
  border: 0; border-radius: 6px; padding: 9px 16px; margin: 4px; font-weight: 700;
}
.apex-btn.secondary { background: transparent; color: #cfe4ff; border: 1px solid rgba(150,196,255,.4); }
.apex-btn:focus-visible { outline: 3px solid var(--apex-good); outline-offset: 2px; }
.apex-countdown {
  left: 50%; top: 40%; transform: translate(-50%,-50%); text-align: center;
  font-size: clamp(48px, 9vw, 140px); font-weight: 800; letter-spacing: .04em;
  text-shadow: 0 4px 24px rgba(0,0,0,.6);
}
.apex-countdown .apex-go { color: var(--apex-good); font-size: .66em; }

/* Live race layout: corner-anchored, central band kept clear. */
.apex-live {
  left: var(--apex-safe); top: var(--apex-safe);
  max-width: min(46vw, 560px); max-height: 24vh;
}
.apex-live .apex-time { font-size: clamp(22px, 2.4vw, 56px); font-weight: 700; letter-spacing: .02em; line-height: 1.1; }
.apex-live .apex-row { color: var(--apex-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apex-live .apex-pos { color: var(--apex-good); font-weight: 700; }
.apex-split { display: inline-block; margin-top: 4px; padding: 1px 8px; border-radius: 999px; font-weight: 700; }
.apex-split.ahead { color: var(--apex-good); background: rgba(110, 231, 160, .14); animation: apex-flash .7s ease-out; }
.apex-split.behind { color: var(--apex-bad); background: rgba(255, 143, 107, .14); animation: apex-flash .7s ease-out; }
.apex-split.even { color: var(--apex-muted); background: rgba(169, 189, 214, .12); }
@keyframes apex-flash { from { transform: scale(1.18); filter: brightness(1.6); } to { transform: scale(1); filter: none; } }
.apex-bad { color: var(--apex-bad); }

/* Minimap: top-right, square, decorative (the live region carries its meaning). */
.apex-minimap { right: var(--apex-safe); top: var(--apex-safe); width: clamp(96px, 12vw, 220px); height: clamp(96px, 12vw, 220px); padding: clamp(6px, .8vw, 12px); }
.apex-minimap svg { width: 100%; height: 100%; display: block; }
.apex-minimap .apex-map-path { fill: none; stroke: rgba(169, 189, 214, .7); stroke-width: .03; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.apex-minimap .apex-map-dot { fill: var(--apex-accent); stroke: #06121f; stroke-width: .02; }

/* Speed: bottom-right, bounded, clear of the centre. */
.apex-speed { right: var(--apex-safe); bottom: var(--apex-safe); text-align: right; max-width: min(46vw, 420px); }
.apex-speed .apex-speed-value { font-size: clamp(28px, 3.4vw, 84px); font-weight: 800; line-height: 1; letter-spacing: .01em; }
.apex-speed .apex-speed-unit { color: var(--apex-muted); font-size: .5em; letter-spacing: .18em; text-transform: uppercase; }

/* Pace notes (#APEX-18): bottom-left, bounded, clear of the centre band. */
.apex-notes {
  left: var(--apex-safe); bottom: var(--apex-safe);
  min-width: clamp(140px, 18vw, 260px); max-width: 40vw;
}
.apex-notes .apex-notes-caption {
  color: var(--apex-muted); font-size: .62em; letter-spacing: .18em; text-transform: uppercase;
}
.apex-notes .apex-notes-call {
  font-size: clamp(22px, 2.6vw, 52px); font-weight: 800; line-height: 1.1;
  letter-spacing: .02em; color: var(--apex-accent);
}
.apex-notes .apex-notes-distance { color: var(--apex-muted); font-size: .8em; }
.apex-notes .apex-notes-following {
  margin-top: 4px; color: var(--apex-muted); font-size: .74em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.apex-notes .apex-notes-voice {
  pointer-events: auto; cursor: pointer; font: inherit; margin-top: 6px;
  color: #cfe4ff; background: transparent; border: 1px solid rgba(150,196,255,.4);
  border-radius: 6px; padding: 3px 9px; font-size: .7em;
}
.apex-notes .apex-notes-voice[aria-pressed="true"] { color: #06121f; background: var(--apex-good); border-color: transparent; }
.apex-notes .apex-notes-voice:focus-visible { outline: 3px solid var(--apex-good); outline-offset: 2px; }

.apex-results { left: 50%; top: 46%; transform: translate(-50%,-50%); width: min(92vw, 480px); max-height: 88vh; overflow: auto; }
.apex-results h2 { margin: 0 0 2px; font-size: 1.5em; }
.apex-pos { font-size: 1.15em; margin: 0 0 12px; color: var(--apex-good); }
.apex-pos.invalid { color: var(--apex-bad); }
.apex-table { width: 100%; border-collapse: collapse; }
.apex-table th { text-align: left; color: var(--apex-muted); font-weight: 600; padding: 0 8px 6px; }
.apex-table th:nth-child(2), .apex-table th:nth-child(3) { text-align: right; }
.apex-table td { padding: 3px 8px; border-bottom: 1px solid rgba(150,196,255,.14); }
.apex-table td:nth-child(2), .apex-table td:last-child { text-align: right; }
.apex-table tr.me td { color: var(--apex-accent); font-weight: 700; }
.apex-total td { border-top: 2px solid rgba(150,196,255,.4); font-weight: 700; }
.apex-help { color: var(--apex-muted); margin-top: 14px; font-size: .82em; line-height: 1.6; }

.apex-hide { display: none !important; }
/* Visually hidden but announced to screen readers. */
.apex-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
@media (max-width: 480px) {
  .apex-live { max-width: 62vw; max-height: 22vh; }
  .apex-minimap { width: clamp(72px, 26vw, 108px); height: clamp(72px, 26vw, 108px); }
}
@media (prefers-reduced-motion: reduce) {
  .apex-hud *, .apex-split { animation: none !important; transition: none !important; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute("class", className);
  return node;
}

/**
 * The race overlay: stage select, countdown, the live HUD (speed, total time,
 * projected position, next gate, split delta and minimap) and the results table.
 *
 * Pure projection — it reads the controller and a telemetry snapshot and never
 * owns race state. `buildHudState` does the formatting/projection so the
 * semantics are unit-tested headlessly; this class only paints. It also hosts
 * the keyboard harness used to simulate gate crossings until in-world gate
 * detection (#APEX-16) supplies real ones: digits `1..9` cross checkpoint N,
 * `F` crosses the finish (both only while racing), `R` restarts, `Q` quits.
 */
export class RaceHud {
  private readonly handlers: RaceHudHandlers;
  private readonly root: HTMLDivElement;
  private readonly selectPanel: HTMLDivElement;
  private readonly countdownPanel: HTMLDivElement;
  private readonly livePanel: HTMLDivElement;
  private readonly minimapPanel: HTMLDivElement;
  private readonly speedPanel: HTMLDivElement;
  private readonly pacePanel: HTMLDivElement;
  private readonly paceCallNode: HTMLDivElement;
  private readonly paceDistanceNode: HTMLDivElement;
  private readonly paceFollowingNode: HTMLDivElement;
  private readonly paceVoiceButton: HTMLButtonElement;
  private readonly paceSrNode: HTMLDivElement;
  private readonly resultsPanel: HTMLDivElement;
  private readonly timeNode: HTMLDivElement;
  private readonly livePosNode: HTMLDivElement;
  private readonly nextNode: HTMLDivElement;
  private readonly splitNode: HTMLSpanElement;
  private readonly speedNode: HTMLSpanElement;
  private readonly mapPath: SVGPathElement;
  private readonly mapDot: SVGCircleElement;
  private readonly countdownNode: HTMLDivElement;
  private readonly srNode: HTMLDivElement;
  private readonly resultsBody: HTMLTableSectionElement;
  private readonly posNode: HTMLParagraphElement;
  private readonly keyListener: (event: KeyboardEvent) => void;
  private currentStageGateIds: string[] = [];
  private finishId = "finish";
  private minimap: HudMinimap | null = null;
  private telemetry: (() => HudTelemetry | null) | null = null;
  private paceSource: (() => PaceNoteView | null) | null = null;
  private voiceAvailable = false;
  private voiceEnabled = false;
  private voiceToggle: ((enabled: boolean) => void) | null = null;
  private lastPaceSr = "";
  private lastSrKey = "";
  private lastSplitIndex = -1;

  constructor(handlers: RaceHudHandlers) {
    this.handlers = handlers;
    const style = el("style");
    style.textContent = STYLE;

    this.root = el("div", "apex-hud");
    this.root.setAttribute("data-testid", "apex-hud");

    // Stage select
    this.selectPanel = el("div", "apex-panel apex-select");
    const title = el("h1", "apex-title", "APEX RALLY");
    const sub = el("p", "apex-sub", "Stage select");
    const start = el("button", "apex-btn", "Start stage");
    start.addEventListener("click", () => this.handlers.onStart());
    this.selectPanel.append(title, sub, start);

    // Countdown
    this.countdownPanel = el("div", "apex-panel apex-countdown");
    this.countdownNode = el("div", undefined, "3");
    this.countdownPanel.append(this.countdownNode);

    // Live HUD — telemetry panel (top-left)
    this.livePanel = el("div", "apex-panel apex-live");
    this.timeNode = el("div", "apex-time", "0:00.000");
    this.livePosNode = el("div", "apex-row apex-pos", "P–");
    this.nextNode = el("div", "apex-row", "");
    this.splitNode = el("span", "apex-split apex-hide", "");
    this.livePanel.append(this.timeNode, this.livePosNode, this.nextNode, this.splitNode);

    // Minimap (top-right, decorative).
    this.minimapPanel = el("div", "apex-panel apex-minimap");
    const svgRoot = svg("svg");
    svgRoot.setAttribute("viewBox", "0 0 1 1");
    svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svgRoot.setAttribute("aria-hidden", "true");
    svgRoot.setAttribute("focusable", "false");
    this.mapPath = svg("path", "apex-map-path");
    this.mapDot = svg("circle", "apex-map-dot");
    this.mapDot.setAttribute("r", "0.045");
    svgRoot.append(this.mapPath, this.mapDot);
    this.minimapPanel.append(svgRoot);

    // Speed (bottom-right).
    this.speedPanel = el("div", "apex-panel apex-speed");
    this.speedNode = el("span", "apex-speed-value", "0");
    const speedUnit = el("div", "apex-speed-unit", "km/h");
    this.speedPanel.append(this.speedNode, speedUnit);

    // Pace notes (bottom-left, #APEX-18).
    this.pacePanel = el("div", "apex-panel apex-notes apex-hide");
    const paceCaption = el("div", "apex-notes-caption", "Pace notes");
    this.paceCallNode = el("div", "apex-notes-call", "");
    this.paceDistanceNode = el("div", "apex-notes-distance", "");
    this.paceFollowingNode = el("div", "apex-notes-following", "");
    this.paceVoiceButton = el("button", "apex-notes-voice", "Voice: off");
    this.paceVoiceButton.setAttribute("type", "button");
    this.paceVoiceButton.setAttribute("aria-pressed", "false");
    this.paceVoiceButton.addEventListener("click", () => this.toggleVoice());
    this.pacePanel.append(
      paceCaption,
      this.paceCallNode,
      this.paceDistanceNode,
      this.paceFollowingNode,
      this.paceVoiceButton,
    );

    // Results
    this.resultsPanel = el("div", "apex-panel apex-results");
    const resultsTitle = el("h2", undefined, "Stage result");
    this.posNode = el("p", "apex-pos", "");
    const table = el("table", "apex-table");
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(
      el("th", undefined, "Gate"),
      el("th", undefined, "Split"),
      el("th", undefined, "Time"),
    );
    head.append(headRow);
    this.resultsBody = el("tbody");
    table.append(head, this.resultsBody);
    const restart = el("button", "apex-btn", "Restart");
    restart.addEventListener("click", () => this.handlers.onRestart());
    const quit = el("button", "apex-btn secondary", "Quit to stage select");
    quit.addEventListener("click", () => this.handlers.onQuit());
    const help = el(
      "div",
      "apex-help",
      "keys: W/A/S/D or arrows drive · 1..9 cross checkpoint · F finish · R restart · Q quit · V voice",
    );
    this.resultsPanel.append(resultsTitle, this.posNode, table, restart, quit, help);

    // Screen-reader race summary (updated only on coarse state changes).
    this.srNode = el("div", "apex-sr");
    this.srNode.setAttribute("role", "status");
    this.srNode.setAttribute("aria-live", "polite");
    this.srNode.setAttribute("aria-atomic", "true");

    // Polite live region for the co-driver call (#APEX-18).
    this.paceSrNode = el("div", "apex-sr");
    this.paceSrNode.setAttribute("role", "status");
    this.paceSrNode.setAttribute("aria-live", "polite");
    this.paceSrNode.setAttribute("aria-atomic", "true");

    this.root.append(
      style,
      this.selectPanel,
      this.countdownPanel,
      this.livePanel,
      this.minimapPanel,
      this.speedPanel,
      this.pacePanel,
      this.resultsPanel,
      this.srNode,
      this.paceSrNode,
    );

    this.keyListener = (event) => this.onKey(event);
  }

  mount(target: HTMLElement): void {
    target.append(this.root);
    document.addEventListener("keydown", this.keyListener);
  }

  dispose(): void {
    document.removeEventListener("keydown", this.keyListener);
    this.root.remove();
  }

  /** Wire a telemetry snapshot source (speed); `null` renders speed as "–". */
  setTelemetry(read: (() => HudTelemetry | null) | null): void {
    this.telemetry = read;
  }

  /** Supply the circuit minimap path; `null` hides the minimap panel. */
  setMinimap(minimap: HudMinimap | null): void {
    this.minimap = minimap;
    const visible = minimap !== null && minimap.points.length > 0;
    this.minimapPanel.classList.toggle("apex-hide", !visible);
    if (visible) this.mapPath.setAttribute("d", minimap!.d);
  }

  /** Wire the co-driver note source (#APEX-18); `null` hides the panel. */
  setPaceNotes(source: (() => PaceNoteView | null) | null): void {
    this.paceSource = source;
    if (source === null) {
      this.pacePanel.classList.add("apex-hide");
      this.paceSrNode.textContent = "";
      this.lastPaceSr = "";
    }
  }

  /**
   * Configure the optional voice toggle. `available` false hides the button
   * (the platform has no speech); otherwise it reflects `enabled` and asks
   * `onToggle` when clicked (or when `V` is pressed).
   */
  setVoice(options: { available: boolean; enabled: boolean; onToggle: (enabled: boolean) => void } | null): void {
    this.voiceAvailable = options?.available ?? false;
    this.voiceEnabled = options?.enabled ?? false;
    this.voiceToggle = options?.onToggle ?? null;
    this.paceVoiceButton.classList.toggle("apex-hide", !this.voiceAvailable);
    this.syncVoiceButton();
  }

  private syncVoiceButton(): void {
    this.paceVoiceButton.textContent = this.voiceEnabled ? "Voice: on" : "Voice: off";
    this.paceVoiceButton.setAttribute("aria-pressed", this.voiceEnabled ? "true" : "false");
  }

  private toggleVoice(): void {
    if (!this.voiceAvailable) return;
    this.voiceEnabled = !this.voiceEnabled;
    this.syncVoiceButton();
    this.voiceToggle?.(this.voiceEnabled);
  }

  /** Project the controller's current state onto the overlay. */
  render(controller: RaceController): void {
    const stage = controller.stage;
    if (stage) {
      this.currentStageGateIds = stage.checkpoints.map((cp) => cp.id);
      this.finishId = stage.finishId;
    }
    const phase = controller.phase;
    this.root.dataset.phase = phase;
    this.toggle(this.selectPanel, phase === "stage_select");
    this.toggle(this.countdownPanel, phase === "countdown");
    this.toggle(this.livePanel, phase === "racing");
    this.toggle(this.minimapPanel, phase === "racing" && this.minimap !== null);
    this.toggle(this.speedPanel, phase === "racing");
    this.toggle(this.pacePanel, false);
    this.toggle(this.resultsPanel, phase === "finished" || phase === "invalidated");

    const state = buildHudState(
      controller,
      this.telemetry ? this.telemetry() : null,
      this.minimap?.points ?? [],
    );

    if (phase === "countdown") {
      const remaining = controller.countdownRemaining;
      this.countdownNode.textContent = remaining > 0 ? String(remaining) : "GO";
      this.countdownNode.classList.toggle("apex-go", remaining <= 0);
    }

    if (phase === "racing") {
      this.timeNode.textContent = state.timeText;
      this.livePosNode.textContent = state.positionText;
      this.nextNode.textContent = `next: ${state.nextText}`;
      if (controller.missedCount > 0) {
        this.nextNode.append(
          el(
            "span",
            "apex-bad",
            ` · +${formatTime(controller.penaltySeconds)} (${controller.missedCount} missed)`,
          ),
        );
      }
      this.speedNode.textContent = state.speedText;

      // Co-driver pace notes (#APEX-18): a pure view of the tracker.
      const paceView = this.paceSource ? this.paceSource() : null;
      const notes = buildPaceNoteHud(paceView);
      this.toggle(this.pacePanel, notes.visible);
      if (notes.visible) {
        this.paceCallNode.textContent = notes.nextCall;
        this.paceDistanceNode.textContent = notes.nextDistance;
        this.paceFollowingNode.textContent = notes.following.length
          ? `then ${notes.following.join(" · ")}`
          : "";
        if (notes.srText !== this.lastPaceSr) {
          this.lastPaceSr = notes.srText;
          this.paceSrNode.textContent = notes.srText;
        }
      }

      const splitIndex = controller.lastSplit?.index ?? -1;
      if (state.split) {
        this.splitNode.textContent = `${state.split.glyph} ${state.split.text}`;
        this.splitNode.className = `apex-split ${state.split.direction}`;
        this.splitNode.setAttribute(
          "aria-label",
          state.split.direction === "ahead"
            ? `Ahead of pace by ${state.split.text.replace("-", "")} seconds`
            : state.split.direction === "behind"
              ? `Behind pace by ${state.split.text.replace("+", "")} seconds`
              : "On pace",
        );
        // Restart the flash only when a new split arrives — not every frame,
        // which would pin the animation at its first keyframe.
        if (splitIndex !== this.lastSplitIndex) void this.splitNode.offsetWidth;
      } else {
        this.splitNode.className = "apex-split apex-hide";
        this.splitNode.textContent = "";
        this.splitNode.removeAttribute("aria-label");
      }
      this.lastSplitIndex = splitIndex;

      if (state.progress) {
        this.mapDot.setAttribute("cx", String(state.progress.x));
        this.mapDot.setAttribute("cy", String(state.progress.y));
      }
      this.mapDot.classList.toggle("apex-hide", state.progress === null);
    }

    if ((phase === "finished" || phase === "invalidated") && controller.result) {
      this.renderResults(controller);
    }

    if (state.srKey !== this.lastSrKey) {
      this.lastSrKey = state.srKey;
      this.srNode.textContent = state.srSummary;
    }
  }

  private renderResults(controller: RaceController): void {
    const result = controller.result!;
    this.resultsBody.replaceChildren();
    for (const split of result.splits) {
      const row = el("tr");
      const name = split.checkpointId === this.finishId ? "Finish" : split.checkpointId;
      row.append(
        el("td", undefined, name),
        el("td", undefined, formatTime(split.delta)),
        el("td", undefined, formatTime(split.time)),
      );
      this.resultsBody.append(row);
    }
    if (result.penaltySeconds > 0) {
      const row = el("tr", "apex-bad");
      row.append(
        el("td", undefined, `Penalties (${result.missedCount})`),
        el("td", undefined, `+${formatTime(result.penaltySeconds)}`),
        el("td", undefined, "+" + formatTime(result.penaltySeconds)),
      );
      this.resultsBody.append(row);
    }
    const totalRow = el("tr", "apex-total");
    totalRow.append(
      el("td", undefined, "Total"),
      el("td", undefined, ""),
      el("td", undefined, formatTime(result.totalTime)),
    );
    this.resultsBody.append(totalRow);

    for (const standing of result.standings) {
      const row = el("tr", standing.isPlayer ? "me" : undefined);
      const label = `${standing.position}. ${standing.name}`;
      row.append(
        el("td", undefined, label),
        el("td", undefined, ""),
        el("td", undefined, formatTime(standing.time)),
      );
      this.resultsBody.append(row);
    }

    if (result.valid && result.position !== null) {
      this.posNode.textContent = `P${result.position} · ${formatTime(result.totalTime)}`;
      this.posNode.classList.remove("invalid");
    } else {
      this.posNode.textContent = "Run invalidated — too many missed checkpoints";
      this.posNode.classList.add("invalid");
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "q") {
      this.handlers.onQuit();
      return;
    }
    if (key === "r") {
      this.handlers.onRestart();
      return;
    }
    if (key === "f") {
      this.handlers.onCrossGate(this.finishId);
      return;
    }
    if (key === "v") {
      this.toggleVoice();
      return;
    }
    if (key === "enter" || key === " ") {
      const phase = this.root.dataset.phase;
      if (phase === "stage_select" || phase === undefined) this.handlers.onStart();
      return;
    }
    if (/^[1-9]$/.test(key)) {
      const gate = this.currentStageGateIds[Number(key) - 1];
      if (gate) this.handlers.onCrossGate(gate);
    }
  }

  private toggle(node: HTMLElement, visible: boolean): void {
    node.classList.toggle("apex-hide", !visible);
  }
}
