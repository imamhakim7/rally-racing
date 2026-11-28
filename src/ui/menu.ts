/**
 * The game menus (#APEX-11): home, stage select and settings.
 *
 * A canvas-independent DOM overlay (epic principle 1) that paints pure view
 * models (`menu-model.ts`) and owns only navigation/focus — never race state.
 * The three-action flow lives here: `home → Play → select card → Race`.
 *
 * Accessibility baseline: real buttons, labelled controls, `aria-pressed` on the
 * active stage card, a polite live region for screen/selection changes, visible
 * `:focus-visible` outlines, and reduced-motion when requested. Full remapping and
 * the WCAG audit are #APEX-12.
 */
import type { StageCatalogEntry } from "../stage";
import { homeMenuContent, stageCards, settingsView } from "./menu-model";
import {
  REDUCED_MOTION_PREFERENCES,
  type GamePreferences,
  type GameSettings,
  type ReducedMotionPreference,
} from "../input/settings";

export type MenuScreen = "home" | "stage_select" | "settings";

export interface MenuHandlers {
  /** A stage card was chosen (load it into the background scene). */
  onStageSelected(stageId: string): void;
  /** The Race button was pressed for the selected stage. */
  onRace(stageId: string): void;
  /** Settings changed — persist them. */
  onSettingsChange(settings: GameSettings): void;
  /** The player asked for the tutorial. */
  onTutorial(): void;
}

export interface MenuHandle {
  readonly element: HTMLElement;
  readonly screen: MenuScreen;
  /** The currently selected stage id, or null before any selection. */
  readonly selectedId: string | null;
  showScreen(screen: MenuScreen): void;
  /** Replace the settings snapshot (e.g. after the tutorial sets `tutorialSeen`). */
  setSettings(settings: GameSettings): void;
  /** Clear any selection and return to the home screen (navigation hygiene, L2). */
  reset(): void;
  dispose(): void;
}

const STYLE = `
.apex-menu, .apex-menu * { box-sizing: border-box; }
.apex-menu {
  --apex-bg: rgba(9, 13, 20, .86);
  --apex-border: rgba(150, 196, 255, .25);
  --apex-fg: #eaf2ff;
  --apex-muted: #a9bdd6;
  --apex-accent: #7fd0ff;
  --apex-good: #6ee7a0;
  --apex-radius: 12px;
  position: fixed; inset: 0; z-index: 20; display: grid; place-items: center;
  padding: max(16px, env(safe-area-inset-top)) 16px; overflow: auto;
  font: clamp(14px, .5vw + 12px, 20px)/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--apex-fg); background: linear-gradient(180deg, rgba(4,7,12,.55), rgba(4,7,12,.9));
}
.apex-menu[hidden] { display: none !important; }
.apex-menu__screen { width: min(92vw, 960px); }
.apex-menu__screen[hidden] { display: none !important; }
.apex-menu h1 { margin: 0 0 4px; font-size: clamp(30px, 4vw, 64px); letter-spacing: .12em; }
.apex-menu h2 { margin: 0 0 12px; font-size: clamp(20px, 2vw, 32px); }
.apex-menu__tagline { margin: 0 0 24px; color: var(--apex-muted); }
.apex-menu__first-run { margin: 20px 0 0; color: var(--apex-muted); font-size: .9em; max-width: 640px; }
.apex-menu__first-run[hidden] { display: none !important; }
.apex-menu__actions { display: flex; flex-wrap: wrap; gap: 12px; }
.apex-btn {
  cursor: pointer; font: inherit; color: #06121f; background: var(--apex-accent);
  border: 1px solid transparent; border-radius: 999px; padding: 12px 28px; font-weight: 700;
}
.apex-btn.secondary { background: transparent; color: #cfe4ff; border-color: rgba(150,196,255,.4); }
.apex-btn:disabled { opacity: .45; cursor: not-allowed; }
.apex-btn:focus-visible, .apex-card:focus-visible, .apex-menu input:focus-visible {
  outline: 3px solid var(--apex-good); outline-offset: 2px;
}
.apex-menu__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.apex-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 0 0 20px; }
.apex-card {
  text-align: left; cursor: pointer; font: inherit; color: var(--apex-fg);
  background: var(--apex-bg); border: 1px solid var(--apex-border); border-radius: var(--apex-radius);
  padding: 16px; display: grid; gap: 6px; transition: border-color .15s, transform .15s;
}
.apex-card:hover { border-color: var(--apex-accent); }
.apex-card[aria-pressed="true"] { border-color: var(--apex-good); box-shadow: inset 0 0 0 2px rgba(110,231,160,.5); }
.apex-card__name { font-size: 1.15em; font-weight: 700; }
.apex-card__meta { color: var(--apex-muted); font-size: .86em; }
.apex-card__difficulty { color: var(--apex-accent); letter-spacing: .1em; }
.apex-settings { display: grid; gap: 20px; max-width: 520px; }
.apex-setting { display: grid; gap: 6px; }
.apex-setting label { font-weight: 700; }
.apex-setting input[type="range"] { width: 100%; accent-color: var(--apex-accent); }
.apex-setting .apex-hint { color: var(--apex-muted); font-size: .82em; }
.apex-menu__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.apex-menu.reduced-motion *, .apex-menu.reduced-motion { transition: none !important; animation: none !important; }
@media (prefers-reduced-motion: reduce) {
  .apex-menu *, .apex-menu { transition: none !important; animation: none !important; }
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

export function mountMenu(
  host: HTMLElement,
  entries: readonly StageCatalogEntry[],
  initialSettings: GameSettings,
  handlers: MenuHandlers,
): MenuHandle {
  const style = el("style");
  style.textContent = STYLE;

  const root = el("div", "apex-menu");
  root.setAttribute("data-testid", "apex-menu");

  const sr = el("div", "apex-menu__sr");
  sr.setAttribute("role", "status");
  sr.setAttribute("aria-live", "polite");
  sr.setAttribute("aria-atomic", "true");

  // ---- Home ---------------------------------------------------------------
  const home = el("section", "apex-menu__screen");
  home.setAttribute("aria-label", "Main menu");
  const content = homeMenuContent();
  const title = el("h1", undefined, content.title);
  const tagline = el("p", "apex-menu__tagline", content.tagline);
  const homeActions = el("div", "apex-menu__actions");
  const play = el("button", "apex-btn", content.playLabel);
  play.type = "button";
  play.setAttribute("data-autofocus", "");
  const tutorial = el("button", "apex-btn secondary", content.tutorialLabel);
  tutorial.type = "button";
  const settingsBtn = el("button", "apex-btn secondary", content.settingsLabel);
  settingsBtn.type = "button";
  homeActions.append(play, tutorial, settingsBtn);
  const firstRun = el(
    "p",
    "apex-menu__first-run",
    "First time? The tutorial walks you through accelerate, brake, handbrake and steering.",
  );
  firstRun.setAttribute("role", "note");
  home.append(title, tagline, homeActions, firstRun);

  // ---- Stage select -------------------------------------------------------
  const select = el("section", "apex-menu__screen");
  select.setAttribute("aria-label", "Stage select");
  select.hidden = true;
  const selectHeader = el("div", "apex-menu__header");
  const selectTitle = el("h2", undefined, "Choose a stage");
  const selectBack = el("button", "apex-btn secondary", "Back");
  selectBack.type = "button";
  selectHeader.append(selectTitle, selectBack);
  const cardsHost = el("div", "apex-cards");
  cardsHost.setAttribute("role", "group");
  cardsHost.setAttribute("aria-label", "Stages");
  const selectActions = el("div", "apex-menu__actions");
  const race = el("button", "apex-btn", "Race");
  race.type = "button";
  race.disabled = true;
  selectActions.append(race);
  select.append(selectHeader, cardsHost, selectActions);

  const cards: { id: string; button: HTMLButtonElement }[] = [];
  for (const card of stageCards(entries)) {
    const button = el("button", "apex-card");
    button.type = "button";
    button.dataset.stageId = card.id;
    button.setAttribute("aria-pressed", "false");
    const name = el("span", "apex-card__name", card.name);
    const meta = el("span", "apex-card__meta", `${card.biome} · ${card.lengthText}`);
    const diff = el("span", "apex-card__difficulty", `${card.difficultyGlyph} ${card.difficultyText}`);
    button.append(name, meta, diff);
    button.addEventListener("click", () => chooseStage(card.id));
    cardsHost.append(button);
    cards.push({ id: card.id, button });
  }

  // ---- Settings -----------------------------------------------------------
  const settingsScreen = el("section", "apex-menu__screen");
  settingsScreen.setAttribute("aria-label", "Settings");
  settingsScreen.hidden = true;
  const settingsHeader = el("div", "apex-menu__header");
  const settingsTitle = el("h2", undefined, "Settings");
  const settingsBack = el("button", "apex-btn secondary", "Back");
  settingsBack.type = "button";
  settingsHeader.append(settingsTitle, settingsBack);

  const settingsForm = el("div", "apex-settings");

  const volumeField = el("div", "apex-setting");
  const volumeLabel = el("label", undefined, "Master volume");
  volumeLabel.htmlFor = "apex-setting-volume";
  const volume = el("input");
  volume.type = "range";
  volume.id = "apex-setting-volume";
  volume.min = "0";
  volume.max = "100";
  volume.step = "1";
  const volumeValue = el("span", "apex-hint", "");
  volumeField.append(volumeLabel, volume, volumeValue);

  const voiceField = el("div", "apex-setting");
  const voiceRow = el("label");
  voiceRow.htmlFor = "apex-setting-voice";
  const voice = el("input");
  voice.type = "checkbox";
  voice.id = "apex-setting-voice";
  const voiceText = el("span", undefined, " Co-driver voice");
  voiceRow.append(voice, voiceText);
  const voiceHint = el("span", "apex-hint", "Read pace notes aloud during a stage.");
  voiceField.append(voiceRow, voiceHint);

  const motionField = el("div", "apex-setting");
  const motionLabel = el("label", undefined, "Reduce motion");
  motionLabel.htmlFor = "apex-setting-motion";
  const motion = el("select");
  motion.id = "apex-setting-motion";
  for (const pref of REDUCED_MOTION_PREFERENCES) {
    const option = el("option");
    option.value = pref;
    option.textContent = pref === "auto" ? "Auto (follow system)" : pref === "on" ? "On" : "Off";
    motion.append(option);
  }
  const motionHint = el("span", "apex-hint", "Disable menu, HUD and camera motion.");
  motionField.append(motionLabel, motion, motionHint);

  settingsForm.append(volumeField, voiceField, motionField);
  settingsScreen.append(settingsHeader, settingsForm);

  root.append(style, sr, home, select, settingsScreen);
  host.append(root);

  // ---- State --------------------------------------------------------------
  let currentScreen: MenuScreen = "home";
  let selectedId: string | null = null;
  let settings: GameSettings = initialSettings;

  function setReducedMotion(): void {
    root.classList.toggle("reduced-motion", settings.accessibility.reducedMotion === "on");
  }

  function announce(message: string): void {
    sr.textContent = message;
  }

  function showScreen(screen: MenuScreen): void {
    currentScreen = screen;
    home.hidden = screen !== "home";
    select.hidden = screen !== "stage_select";
    settingsScreen.hidden = screen !== "settings";
    root.dataset.screen = screen;
    renderSettings();
    setReducedMotion();
    const target =
      screen === "stage_select"
        ? (selectedId && cards.find((c) => c.id === selectedId)?.button) || cards[0]?.button
        : screen === "settings"
          ? volume
          : play;
    target?.focus();
    announce(
      screen === "home"
        ? "Main menu."
        : screen === "stage_select"
          ? "Stage select. Choose a stage, then Race."
          : "Settings.",
    );
  }

  function chooseStage(id: string): void {
    selectedId = id;
    for (const card of cards) {
      card.button.setAttribute("aria-pressed", card.id === id ? "true" : "false");
    }
    race.disabled = false;
    handlers.onStageSelected(id);
    const name = entries.find((entry) => entry.id === id)?.name ?? id;
    announce(`Selected ${name}. Press Race to start.`);
  }

  function emitSettings(next: GameSettings, announceText: string): void {
    settings = next;
    handlers.onSettingsChange(settings);
    renderSettings();
    setReducedMotion();
    announce(announceText);
  }

  function withGame(patch: Partial<GamePreferences>): GameSettings {
    return { ...settings, game: { ...settings.game, ...patch } };
  }

  function withMotion(pref: ReducedMotionPreference): GameSettings {
    return {
      ...settings,
      accessibility: { ...settings.accessibility, reducedMotion: pref },
    };
  }

  function renderSettings(): void {
    const view = settingsView(settings);
    volume.value = String(view.volumePercent);
    volumeValue.textContent = `${view.volumePercent}%`;
    voice.checked = view.voice;
    motion.value = view.reducedMotion;
    // First-run gating: the callout disappears once the tutorial has been seen (AC5).
    firstRun.hidden = view.tutorialSeen;
  }

  function setSettings(next: GameSettings): void {
    settings = next;
    renderSettings();
    setReducedMotion();
  }

  play.addEventListener("click", () => showScreen("stage_select"));
  tutorial.addEventListener("click", () => handlers.onTutorial());
  settingsBtn.addEventListener("click", () => showScreen("settings"));
  selectBack.addEventListener("click", () => showScreen("home"));
  settingsBack.addEventListener("click", () => showScreen("home"));
  race.addEventListener("click", () => {
    if (selectedId) handlers.onRace(selectedId);
  });
  volume.addEventListener("input", () =>
    emitSettings(
      withGame({ volume: Number(volume.value) / 100 }),
      `Volume ${volume.value} percent.`,
    ),
  );
  voice.addEventListener("change", () =>
    emitSettings(withGame({ voice: voice.checked }), voice.checked ? "Voice on." : "Voice off."),
  );
  motion.addEventListener("change", () =>
    emitSettings(
      withMotion(motion.value as ReducedMotionPreference),
      `Reduced motion ${motion.value}.`,
    ),
  );

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && currentScreen !== "home") showScreen("home");
  };
  root.addEventListener("keydown", onKey);

  renderSettings();
  setReducedMotion();
  root.dataset.screen = "home";

  function reset(): void {
    selectedId = null;
    for (const card of cards) card.button.setAttribute("aria-pressed", "false");
    race.disabled = true;
    showScreen("home");
  }

  return {
    element: root,
    get screen() {
      return currentScreen;
    },
    get selectedId() {
      return selectedId;
    },
    showScreen,
    setSettings,
    reset,
    dispose() {
      root.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
