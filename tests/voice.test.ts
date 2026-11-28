import { describe, expect, it } from "vitest";
import {
  createSpeechVoice,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
} from "../src/race/voice";

function fakeSynth(): {
  synth: SpeechSynthesisLike;
  spoken: string[];
  cancels: () => number;
} {
  const spoken: string[] = [];
  let cancels = 0;
  const synth: SpeechSynthesisLike = {
    speak(utterance: SpeechSynthesisUtteranceLike) {
      spoken.push(utterance.text);
    },
    cancel() {
      cancels += 1;
    },
  };
  return { synth, spoken, cancels: () => cancels };
}

describe("createSpeechVoice — availability", () => {
  it("returns a safe no-op voice with no source", () => {
    const voice = createSpeechVoice(null);
    expect(voice.available).toBe(false);
    expect(() => voice.speak("Right 3")).not.toThrow();
    expect(() => voice.cancel()).not.toThrow();
  });

  it("returns a no-op voice when the source lacks speech synthesis", () => {
    const voice = createSpeechVoice({});
    expect(voice.available).toBe(false);
  });
});

describe("createSpeechVoice — speaking (AC3)", () => {
  it("cancels the previous call before speaking the next", () => {
    const { synth, spoken, cancels } = fakeSynth();
    const voice = createSpeechVoice({ speechSynthesis: synth });
    expect(voice.available).toBe(true);

    voice.speak("Right 3");
    expect(spoken).toEqual(["Right 3"]);
    expect(cancels()).toBe(1);

    voice.speak("Left 5");
    expect(spoken).toEqual(["Right 3", "Left 5"]);
    expect(cancels()).toBe(2);
  });

  it("ignores empty or whitespace-only text", () => {
    const { synth, spoken, cancels } = fakeSynth();
    const voice = createSpeechVoice({ speechSynthesis: synth });
    voice.speak("");
    voice.speak("   ");
    expect(spoken).toEqual([]);
    expect(cancels()).toBe(0);
  });

  it("applies the configured rate to the utterance", () => {
    const { synth } = fakeSynth();
    const utterances: SpeechSynthesisUtteranceLike[] = [];
    class Utterance implements SpeechSynthesisUtteranceLike {
      text: string;
      rate?: number;
      constructor(text: string) {
        this.text = text;
        utterances.push(this);
      }
    }
    const voice = createSpeechVoice(
      { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance },
      { rate: 1.3, pitch: 1.1 },
    );
    voice.speak("Hairpin left");
    expect(utterances).toHaveLength(1);
    expect(utterances[0]!.text).toBe("Hairpin left");
    expect(utterances[0]!.rate).toBe(1.3);
    expect(utterances[0]!.pitch).toBe(1.1);
  });

  it("never throws when the speech backend throws", () => {
    const synth: SpeechSynthesisLike = {
      speak() {
        throw new Error("no audio device");
      },
      cancel() {
        throw new Error("no audio device");
      },
    };
    const voice = createSpeechVoice({ speechSynthesis: synth });
    expect(() => voice.speak("Right 3")).not.toThrow();
    expect(() => voice.cancel()).not.toThrow();
  });
});
