import { describe, expect, it } from "vitest";
import { sessionRhythmSignal } from "../../src/signals/session-rhythm";
import type { Environment, EvidenceEvent } from "../../src/core/types";
import { fixtureNamed } from "../fixtures";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

function typedKeysAt(times: number[]): EvidenceEvent[] {
  return times.map((t) => ({ kind: "key", t, trusted: true, printable: true, modifier: null }));
}

function scriptedChangesAt(times: number[]): EvidenceEvent[] {
  return times.map((t) => ({ kind: "change", t, trusted: false, field: "text" }));
}

function keysFrom(start: number, gaps: number[]): number[] {
  return gaps.reduce<number[]>((times, gap) => [...times, (times.at(-1) ?? start) + gap], [start]);
}

describe("sessionRhythmSignal", () => {
  it("bursty session rhythm is agent-like", () => {
    const events = scriptedChangesAt([1000.5, 1020.5, 1040.5, 5000.5, 5030.5, 5060.5, 5090.5, 9000.5]);
    const result = sessionRhythmSignal.evaluate(events, cleanEnvironment);
    expect(result.id).toBe("session-rhythm");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons.join(" ")).toContain("2 bursts");
  });

  it("a single burst is not applicable", () => {
    const events = scriptedChangesAt([1000.5, 1020.5, 1040.5, 5000.5]);
    expect(sessionRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("bursts without idle gaps between them are not applicable", () => {
    const events = scriptedChangesAt([1000.5, 1020.5, 1040.5, 2000.5, 2020.5, 2040.5]);
    expect(sessionRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("steady human typing is not applicable", () => {
    const events = typedKeysAt([1000.5, 1180.5, 1390.5, 1570.5, 1800.5, 6000.5, 6210.5, 6400.5]);
    expect(sessionRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("a fast typist's words are not bursts", () => {
    const wordGaps = [60, 75, 140, 60, 90, 65, 120, 70];
    const firstWord = keysFrom(1000.5, wordGaps);
    const secondWord = keysFrom((firstWord.at(-1) ?? 0) + 5000, wordGaps);
    const result = sessionRhythmSignal.evaluate(typedKeysAt([...firstWord, ...secondWord]), cleanEnvironment);
    expect(result.applicable === false || result.agentLikelihood <= 0.2).toBe(true);
  });

  it("held Tab key repeats are not bursts", () => {
    const firstHold = Array.from({ length: 10 }, (_, index) => 1000.5 + index * 33);
    const secondHold = firstHold.map((t) => t + 7000);
    const events: EvidenceEvent[] = [...firstHold, ...secondHold].map((t) => ({
      kind: "key",
      t,
      trusted: true,
      printable: false,
      modifier: null,
    }));
    const result = sessionRhythmSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable === false || result.agentLikelihood <= 0.2).toBe(true);
  });

  it("held Backspace key repeats are not bursts", () => {
    const firstHold = Array.from({ length: 10 }, (_, index) => 1000.5 + index * 33);
    const secondHold = firstHold.map((t) => t + 7000);
    const events: EvidenceEvent[] = [...firstHold, ...secondHold].flatMap((t, index): EvidenceEvent[] => [
      { kind: "key", t, trusted: true, printable: false, modifier: null },
      { kind: "input", t: t + 1, trusted: true, inputType: "deleteContentBackward", length: 20 - index, field: "text" },
    ]);
    const result = sessionRhythmSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable === false || result.agentLikelihood <= 0.2).toBe(true);
  });

  it("human fixture is not flagged", () => {
    const fixture = fixtureNamed("human-desktop-001");
    expect(sessionRhythmSignal.evaluate(fixture.events, fixture.env).applicable).toBe(false);
  });
});
