/**
 * Optional co-driver voice.
 *
 * A one-method port over the browser's `speechSynthesis`. The core note logic
 * (`pace-notes.ts`) never touches a platform API; the composition root builds a
 * `Voice` from `window` and speaks the note the tracker hands it. The port is
 * constructed from a *structural* source so headless tests pass a fake and a
 * device with no speech support gets a safe no-op.
 */

/** The subset of `SpeechSynthesisUtterance` this port sets. */
export interface SpeechSynthesisUtteranceLike {
  text: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

/** The subset of `SpeechSynthesis` this port uses. */
export interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
}

/** A platform object that may carry speech synthesis (e.g. `window`). */
export interface SpeechSource {
  speechSynthesis?: SpeechSynthesisLike | null;
  /** The utterance constructor, when the platform exposes one. */
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike;
}

export interface VoiceOptions {
  /** Speech rate; the co-driver reads briskly. Default 1.15. */
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

export interface Voice {
  /** False when the platform cannot speak; `speak` is then a no-op. */
  readonly available: boolean;
  /** Read `text`; an empty string is ignored. Cancels any in-flight call first. */
  speak(text: string): void;
  /** Stop the current call. Idempotent. */
  cancel(): void;
}

const NOOP_VOICE: Voice = {
  available: false,
  speak() {},
  cancel() {},
};

function isEmpty(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Build a `Voice` from a speech source. With no usable source (unknown platform,
 * tests, or a browser without speech) it returns an unavailable no-op voice, so
 * callers never need to null-check.
 */
export function createSpeechVoice(
  source?: SpeechSource | null,
  options: VoiceOptions = {},
): Voice {
  const synth = source?.speechSynthesis;
  if (!synth || typeof synth.speak !== "function" || typeof synth.cancel !== "function") {
    return NOOP_VOICE;
  }

  const rate = options.rate ?? 1.15;
  const Utterance = source?.SpeechSynthesisUtterance;

  const build = (text: string): SpeechSynthesisUtteranceLike => {
    const utterance =
      Utterance !== undefined
        ? new Utterance(text)
        : ({ text } as SpeechSynthesisUtteranceLike);
    utterance.rate = rate;
    if (options.pitch !== undefined) utterance.pitch = options.pitch;
    if (options.volume !== undefined) utterance.volume = options.volume;
    if (options.lang !== undefined) utterance.lang = options.lang;
    return utterance;
  };

  return {
    available: true,
    speak(text: string) {
      if (isEmpty(text)) return;
      try {
        synth.cancel();
        synth.speak(build(text));
      } catch {
        // A speech backend that throws must never break the race loop.
      }
    },
    cancel() {
      try {
        synth.cancel();
      } catch {
        // ignore
      }
    },
  };
}
