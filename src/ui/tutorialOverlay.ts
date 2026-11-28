/**
 * Tutorial overlay (#APEX-11): a thin DOM projection of `TutorialModel`.
 *
 * The gating logic lives in `tutorial.ts` (pure, tested); this file only paints
 * the current lesson and offers a skip button. It reads the model each frame and
 * writes text only when the lesson changes.
 */
import type { TutorialModel } from "./tutorial";

export interface TutorialOverlayHandle {
  readonly element: HTMLElement;
  /** Paint the current lesson state; cheap to call every frame. */
  update(model: TutorialModel): void;
  /** Move focus to the skip control when the tutorial opens. */
  focus(): void;
  dispose(): void;
}

const STYLE = `
.apex-tutorial, .apex-tutorial * { box-sizing: border-box; }
.apex-tutorial {
  position: fixed; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%);
  z-index: 15; width: min(92vw, 560px); padding: 16px 20px; border-radius: 14px;
  background: rgba(9, 13, 20, .9); border: 1px solid rgba(150, 196, 255, .3); color: #eaf2ff;
  font: clamp(13px, .5vw + 11px, 17px)/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.apex-tutorial[hidden] { display: none !important; }
.apex-tutorial__step { color: #a9bdd6; font-size: .8em; letter-spacing: .16em; text-transform: uppercase; }
.apex-tutorial__title { margin: 2px 0 0; font-size: 1.25em; font-weight: 700; }
.apex-tutorial__instruction { margin: 2px 0 12px; }
.apex-tutorial__progress { display: flex; gap: 6px; margin-bottom: 12px; }
.apex-tutorial__pip { width: 100%; height: 5px; border-radius: 999px; background: rgba(169,189,214,.28); }
.apex-tutorial__pip.done { background: #6ee7a0; }
.apex-tutorial__pip.active { background: #7fd0ff; }
.apex-tutorial button { cursor: pointer; font: inherit; color: #cfe4ff; background: transparent;
  border: 1px solid rgba(150,196,255,.4); border-radius: 999px; padding: 6px 16px; }
.apex-tutorial button:focus-visible { outline: 3px solid #6ee7a0; outline-offset: 2px; }
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

export function mountTutorialOverlay(host: HTMLElement, onSkip: () => void): TutorialOverlayHandle {
  const style = el("style");
  style.textContent = STYLE;

  const root = el("div", "apex-tutorial");
  root.setAttribute("data-testid", "apex-tutorial");
  root.hidden = true;

  const step = el("div", "apex-tutorial__step", "");
  const title = el("div", "apex-tutorial__title", "");
  const instruction = el("div", "apex-tutorial__instruction", "");
  const progress = el("div", "apex-tutorial__progress");
  progress.setAttribute("aria-hidden", "true");
  const actions = el("div");
  const skip = el("button", undefined, "Skip tutorial");
  skip.type = "button";
  skip.addEventListener("click", () => onSkip());
  actions.append(skip);

  const sr = el("div", "apex-tutorial__step");
  sr.setAttribute("role", "status");
  sr.setAttribute("aria-live", "polite");
  sr.setAttribute("aria-atomic", "true");

  root.append(style, sr, step, title, instruction, progress, actions);
  host.append(root);

  const pips: HTMLElement[] = [];

  function renderPips(total: number, index: number, complete: boolean): void {
    while (pips.length < total) {
      const pip = el("div", "apex-tutorial__pip");
      pips.push(pip);
      progress.append(pip);
    }
    pips.forEach((pip, i) => {
      const done = complete || i < index;
      const active = !complete && i === index;
      pip.className = `apex-tutorial__pip${done ? " done" : active ? " active" : ""}`;
    });
  }

  let lastText = "";

  return {
    element: root,
    update(model) {
      root.hidden = false;
      const lesson = model.lesson;
      renderPips(model.total, model.index, model.complete);
      const text = model.srText;
      if (text === lastText) return;
      lastText = text;
      if (lesson) {
        step.textContent = `Step ${model.index + 1} of ${model.total}`;
        title.textContent = lesson.title;
        instruction.textContent = lesson.instruction;
        sr.textContent = text;
      } else {
        step.textContent = "";
        title.textContent = "Tutorial complete";
        instruction.textContent = "Nice driving — you're ready to race.";
        sr.textContent = text;
      }
    },
    focus() {
      skip.focus();
    },
    dispose() {
      root.remove();
    },
  };
}
