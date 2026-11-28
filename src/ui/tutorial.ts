/**
 * First-run driving tutorial (#APEX-11).
 *
 * A tiny sequential state machine: lessons are presented in order and the
 * current lesson advances **only** when the player actually performs its action.
 * It is pure (it reads a `VehicleInput` and a speed sample, owns no DOM), so the
 * gating is unit-tested headlessly; `tutorialOverlay.ts` only paints it.
 */
import type { VehicleInput } from "../physics/vehicle";

export type TutorialLessonId = "accelerate" | "brake" | "handbrake" | "steer";

export interface TutorialLesson {
  id: TutorialLessonId;
  title: string;
  instruction: string;
  /** True when the player has performed this lesson's action. */
  isSatisfied(input: VehicleInput, speedKmh: number): boolean;
}

export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  {
    id: "accelerate",
    title: "Accelerate",
    instruction: "Hold W or ↑ to accelerate.",
    isSatisfied: (input) => input.throttle > 0,
  },
  {
    id: "brake",
    title: "Brake",
    instruction: "Press S or ↓ to brake.",
    isSatisfied: (input) => input.brake > 0,
  },
  {
    id: "handbrake",
    title: "Handbrake",
    instruction: "Press Space to pull the handbrake and slide the tail out.",
    isSatisfied: (input) => input.handbrake,
  },
  {
    id: "steer",
    title: "Steering",
    instruction: "Steer with A/D or ←/→ while the car is rolling.",
    // Steering only counts while the car is moving, so the lesson cannot be
    // passed by wiggling the wheel on the start line (throttle/brake not required).
    isSatisfied: (input, speedKmh) => input.steer !== 0 && speedKmh > 1,
  },
];

export class TutorialModel {
  private idx = 0;

  constructor(private readonly lessons: readonly TutorialLesson[] = TUTORIAL_LESSONS) {}

  get total(): number {
    return this.lessons.length;
  }

  /** 0-based index of the active lesson; equals `total` when complete. */
  get index(): number {
    return this.idx;
  }

  get lesson(): TutorialLesson | null {
    return this.idx < this.lessons.length ? this.lessons[this.idx]! : null;
  }

  get complete(): boolean {
    return this.idx >= this.lessons.length;
  }

  /**
   * Feed the latest input. Advances at most one lesson per call and returns true
   * when a lesson was just satisfied. Once complete this is a no-op.
   */
  observe(input: VehicleInput, speedKmh = 0): boolean {
    const lesson = this.lesson;
    if (!lesson) return false;
    if (!lesson.isSatisfied(input, speedKmh)) return false;
    this.idx += 1;
    return true;
  }

  reset(): void {
    this.idx = 0;
  }

  /** A single sentence for the polite live region. */
  get srText(): string {
    const lesson = this.lesson;
    if (!lesson) return "Tutorial complete.";
    return `Lesson ${this.idx + 1} of ${this.total}: ${lesson.title}. ${lesson.instruction}`;
  }
}
