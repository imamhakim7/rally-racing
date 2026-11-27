import { formatTime } from "./results";
import type { RaceController } from "./race";

export interface RaceHudHandlers {
  onStart: () => void;
  onRestart: () => void;
  onQuit: () => void;
  /** Simulated gate crossing from the keyboard harness (until #APEX-2 lands). */
  onCrossGate: (gateId: string) => void;
}

const STYLE = `
.apex-hud, .apex-hud * { box-sizing: border-box; }
.apex-hud {
  position: fixed; inset: 0; pointer-events: none;
  font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #eaf2ff;
}
.apex-panel {
  pointer-events: auto; position: absolute; background: rgba(9,13,20,.86);
  border: 1px solid rgba(150,196,255,.25); border-radius: 10px; padding: 18px 22px;
  backdrop-filter: blur(3px);
}
.apex-select { left: 50%; top: 42%; transform: translate(-50%,-50%); text-align: center; min-width: 340px; }
.apex-title { font-size: 22px; letter-spacing: .12em; margin: 0 0 4px; }
.apex-sub { color: #9fb2cc; margin: 0 0 16px; }
.apex-btn {
  pointer-events: auto; cursor: pointer; font: inherit; color: #06121f; background: #7fd0ff;
  border: 0; border-radius: 6px; padding: 9px 16px; margin: 0 4px; font-weight: 700;
}
.apex-btn.secondary { background: transparent; color: #cfe4ff; border: 1px solid rgba(150,196,255,.4); }
.apex-countdown {
  left: 50%; top: 40%; transform: translate(-50%,-50%); text-align: center;
  font-size: 96px; font-weight: 800; letter-spacing: .04em; text-shadow: 0 4px 24px rgba(0,0,0,.6);
}
.apex-countdown .apex-go { color: #8ef2a5; font-size: 64px; }
.apex-live { left: 18px; top: 18px; }
.apex-live .apex-time { font-size: 30px; font-weight: 700; letter-spacing: .02em; }
.apex-live .apex-row { color: #9fb2cc; margin-top: 4px; }
.apex-bad { color: #ff9d7a; }
.apex-results { left: 50%; top: 46%; transform: translate(-50%,-50%); min-width: 420px; }
.apex-results h2 { margin: 0 0 2px; font-size: 20px; }
.apex-pos { font-size: 15px; margin: 0 0 12px; color: #8ef2a5; }
.apex-pos.invalid { color: #ff9d7a; }
.apex-table { width: 100%; border-collapse: collapse; }
.apex-table th { text-align: left; color: #6f8199; font-weight: 600; padding: 0 8px 6px; }
.apex-table th:nth-child(2), .apex-table th:nth-child(3) { text-align: right; }
.apex-table td { padding: 3px 8px; border-bottom: 1px solid rgba(150,196,255,.14); }
.apex-table td:nth-child(2), .apex-table td:last-child { text-align: right; }
.apex-table tr.me td { color: #7fd0ff; font-weight: 700; }
.apex-total td { border-top: 2px solid rgba(150,196,255,.4); font-weight: 700; }
.apex-help { color: #6f8199; margin-top: 14px; font-size: 11px; line-height: 1.6; }
.apex-hide { display: none !important; }
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

/**
 * The race overlay: stage select, countdown, live timer and the results table.
 *
 * Pure projection — it reads the controller and never owns race state. It also
 * hosts the keyboard harness used to simulate gate crossings until the vehicle
 * (#APEX-2) supplies real ones: digits `1..9` cross checkpoint N, `F` crosses
 * the finish (both only take effect while racing), `R` restarts, `Q` quits.
 */
export class RaceHud {
  private readonly handlers: RaceHudHandlers;
  private readonly root: HTMLDivElement;
  private readonly selectPanel: HTMLDivElement;
  private readonly countdownPanel: HTMLDivElement;
  private readonly livePanel: HTMLDivElement;
  private readonly resultsPanel: HTMLDivElement;
  private readonly timeNode: HTMLDivElement;
  private readonly nextNode: HTMLDivElement;
  private readonly countdownNode: HTMLDivElement;
  private readonly resultsBody: HTMLTableSectionElement;
  private readonly posNode: HTMLParagraphElement;
  private readonly keyListener: (event: KeyboardEvent) => void;
  private currentStageGateIds: string[] = [];
  private finishId = "finish";

  constructor(handlers: RaceHudHandlers) {
    this.handlers = handlers;
    const style = el("style");
    style.textContent = STYLE;

    this.root = el("div", "apex-hud");

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

    // Live HUD
    this.livePanel = el("div", "apex-panel apex-live");
    this.timeNode = el("div", "apex-time", "0:00.000");
    this.nextNode = el("div", "apex-row", "");
    this.livePanel.append(this.timeNode, this.nextNode);

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
      "keys: 1..9 cross checkpoint · F finish · R restart · Q quit to stage select",
    );
    this.resultsPanel.append(resultsTitle, this.posNode, table, restart, quit, help);

    this.root.append(style, this.selectPanel, this.countdownPanel, this.livePanel, this.resultsPanel);

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
    this.toggle(this.resultsPanel, phase === "finished" || phase === "invalidated");

    if (phase === "countdown") {
      const remaining = controller.countdownRemaining;
      this.countdownNode.textContent = remaining > 0 ? String(remaining) : "GO";
      this.countdownNode.classList.toggle("apex-go", remaining <= 0);
    }

    if (phase === "racing") {
      this.timeNode.textContent = formatTime(controller.elapsed + controller.penaltySeconds);
      const next = controller.nextCheckpoint;
      this.nextNode.textContent = next ? `next: ${next.name}` : "to finish";
      if (controller.missedCount > 0) {
        const bad = el(
          "span",
          "apex-bad",
          ` · +${formatTime(controller.penaltySeconds)} (${controller.missedCount} missed)`,
        );
        this.nextNode.append(bad);
      }
    }

    if ((phase === "finished" || phase === "invalidated") && controller.result) {
      const result = controller.result;
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
        row.append(el("td", undefined, label), el("td", undefined, ""), el("td", undefined, formatTime(standing.time)));
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
