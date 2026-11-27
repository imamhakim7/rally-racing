/**
 * Minimal stage select.
 *
 * #APEX-11 owns the real menu; this is the smallest control that lets a content
 * author (and the screenshot evidence) switch circuits live. It is a pure
 * projection of `StageLibrary.list()` — no stage state lives here.
 */
import type { StageLibrary } from "./library";
import type { StageSceneHandle } from "./scene";

export interface StageSelectHandle {
  readonly element: HTMLElement;
  /** Programmatically choose a stage (updates the scene too). */
  select(id: string): void;
  dispose(): void;
}

export function mountStageSelect(
  host: HTMLElement,
  library: StageLibrary,
  scene: StageSceneHandle,
): StageSelectHandle {
  const wrapper = document.createElement("label");
  wrapper.className = "stage-select";

  const caption = document.createElement("span");
  caption.textContent = "Stage";
  caption.className = "stage-select__caption";

  const select = document.createElement("select");
  select.className = "stage-select__control";
  select.setAttribute("aria-label", "Select a stage");

  for (const entry of library.list()) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.name} (${entry.biome})`;
    select.append(option);
  }
  select.value = scene.current.id;
  select.addEventListener("change", () => {
    scene.load(select.value);
  });

  wrapper.append(caption, select);
  host.append(wrapper);

  return {
    element: wrapper,
    select(id) {
      if (!library.has(id)) throw new Error(`unknown stage: ${id}`);
      select.value = id;
      scene.load(id);
    },
    dispose() {
      wrapper.remove();
    },
  };
}
