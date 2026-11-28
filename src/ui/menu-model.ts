/**
 * DOM-free view models for the menus (#APEX-11).
 *
 * Every string a menu renders is produced here so the formatting (stage length,
 * difficulty glyph + word, settings summary) is unit-testable headlessly and the
 * DOM layer only paints. Never interpolates user input.
 */
import type { StageCatalogEntry } from "../stage";
import type { GameSettings, ReducedMotionPreference } from "../input/settings";

/** The three actions from home to a race, in order (the AC1 contract). */
export const THREE_ACTIONS = ["Play", "Select a stage", "Race"] as const;

export interface StageCardView {
  id: string;
  name: string;
  biome: string;
  /** Human length, e.g. `"2.4 km"`. */
  lengthText: string;
  /** 1..5. */
  difficulty: number;
  /** Word label, e.g. `"Hard"`. */
  difficultyText: string;
  /** Filled/empty stars, e.g. `"★★★☆☆"` — meaning never relies on colour. */
  difficultyGlyph: string;
}

const DIFFICULTY_NAMES = ["Very easy", "Easy", "Medium", "Hard", "Expert"] as const;

/** Coerce an arbitrary difficulty into an integer 1..5 (defaults to 1). */
export function clampDifficulty(difficulty: number): number {
  return Number.isFinite(difficulty) ? Math.min(5, Math.max(1, Math.round(difficulty))) : 1;
}

/** Metres as `"850 m"` / `"2.4 km"`; non-finite falls back to an em dash. */
export function formatLength(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Difficulty as a glyph **and** a word. The input is clamped/rounded into 1..5
 * so a bad stage value can never render an empty or overflowing label.
 */
export function difficultyLabel(difficulty: number): { glyph: string; text: string } {
  const level = clampDifficulty(difficulty);
  return {
    glyph: "★".repeat(level) + "☆".repeat(5 - level),
    text: DIFFICULTY_NAMES[level - 1]!,
  };
}

export function toStageCard(entry: StageCatalogEntry): StageCardView {
  const level = clampDifficulty(entry.difficulty);
  const label = difficultyLabel(level);
  return {
    id: entry.id,
    name: entry.name,
    biome: entry.biome,
    lengthText: formatLength(entry.lengthM),
    difficulty: level,
    difficultyText: label.text,
    difficultyGlyph: label.glyph,
  };
}

/** The stage-select carousel, ordered as the library supplies it. */
export function stageCards(entries: readonly StageCatalogEntry[]): StageCardView[] {
  return entries.map(toStageCard);
}

/**
 * The next stage id in catalog order, wrapping at the end (the results
 * "Next stage" affordance). Unknown/empty input returns `current`.
 */
export function nextStageId(ids: readonly string[], current: string): string {
  if (ids.length === 0) return current;
  const index = ids.indexOf(current);
  return ids[(index + 1) % ids.length]!;
}

export interface HomeMenuContent {
  title: string;
  tagline: string;
  playLabel: string;
  tutorialLabel: string;
  settingsLabel: string;
}

export function homeMenuContent(): HomeMenuContent {
  return {
    title: "Apex Rally",
    tagline: "Point-to-point rally racing",
    playLabel: "Play",
    tutorialLabel: "Tutorial",
    settingsLabel: "Settings",
  };
}

export interface SettingsView {
  volumePercent: number;
  voice: boolean;
  reducedMotion: ReducedMotionPreference;
  tutorialSeen: boolean;
}

/**
 * A render-ready snapshot of the game preferences owned by the menu. Volume is a
 * whole percent 0..100; reduced motion is the shared "auto"|"on"|"off" preference
 * (the a11y/remapping panel from #APEX-12 owns the rest of `GameSettings`).
 */
export function settingsView(settings: GameSettings): SettingsView {
  const volume = Math.min(1, Math.max(0, settings.game.volume));
  return {
    volumePercent: Math.round(volume * 100),
    voice: settings.game.voice,
    reducedMotion: settings.accessibility.reducedMotion,
    tutorialSeen: settings.game.tutorialSeen,
  };
}
