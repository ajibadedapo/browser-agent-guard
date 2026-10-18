import { describe, expect, it } from "vitest";
import { typingRhythmSignal } from "../../src/signals/typing-rhythm";
import type { Environment, EvidenceEvent } from "../../src/core/types";
import { fixtureNamed } from "../fixtures";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

function printableKeysAt(times: number[]): EvidenceEvent[] {
  return times.map((t) => ({ kind: "key", t, trusted: true, printable: true, modifier: null }));
}

describe("typingRhythmSignal", () => {
  it("claude fixture typing is machine speed", () => {
    const fixture = fixtureNamed("claude-in-chrome-nomarkers-001");
    const result = typingRhythmSignal.evaluate(fixture.events, fixture.env);
    expect(result.id).toBe("typing-rhythm");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons.join(" ")).toMatch(/typed 45 characters/);
  });

  it("human fixture typing is human", () => {
    const fixture = fixtureNamed("human-desktop-001");
    const result = typingRhythmSignal.evaluate(fixture.events, fixture.env);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeLessThanOrEqual(0.2);
  });

  it("fast but uneven typing is human", () => {
    const events = printableKeysAt([1000.5, 1001.5, 1002.5, 1003.5, 1004.5, 1005.5, 1006.5, 1007.5, 1200.5]);
    expect(typingRhythmSignal.evaluate(events, cleanEnvironment).agentLikelihood).toBeLessThanOrEqual(0.2);
  });

  it("eight printable keys at 4 ms is agent-like", () => {
    const events = printableKeysAt([1000.5, 1004.5, 1008.5, 1012.5, 1016.5, 1020.5, 1024.5, 1028.5]);
    const result = typingRhythmSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
  });

  it("agent typing three fields with pauses between them is machine speed", () => {
    const field = (start: number) => Array.from({ length: 15 }, (_, index) => start + index * 4);
    const events = printableKeysAt([...field(1000.5), ...field(4056.5), ...field(7112.5)]);
    const result = typingRhythmSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons.join(" ")).toContain("3 runs");
  });

  it("keys separated by long pauses are not applicable", () => {
    const events = printableKeysAt([1000.5, 3000.5, 5000.5, 7000.5, 9000.5, 11000.5, 13000.5, 15000.5]);
    expect(typingRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("three keys is not applicable", () => {
    const events = printableKeysAt([1000.5, 1004.5, 1008.5]);
    expect(typingRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("modifier and non-printable keys do not count", () => {
    const events: EvidenceEvent[] = [
      ...printableKeysAt([1000.5, 1004.5, 1008.5]),
      ...[1012.5, 1016.5, 1020.5, 1024.5, 1028.5].map(
        (t): EvidenceEvent => ({ kind: "key", t, trusted: true, printable: false, modifier: null }),
      ),
    ];
    expect(typingRhythmSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });
});
