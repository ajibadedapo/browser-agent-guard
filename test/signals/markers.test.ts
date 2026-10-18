import { describe, expect, it } from "vitest";
import { KNOWN_MARKERS } from "../../src/signals/markers-list";
import { markersSignal } from "../../src/signals/markers";
import type { Environment, EvidenceEvent } from "../../src/core/types";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

describe("markersSignal", () => {
  it("claude glow border names claude-in-chrome", () => {
    const events: EvidenceEvent[] = [
      { kind: "marker", t: 1000.5, agent: "claude-in-chrome", marker: "#claude-agent-glow-border" },
    ];
    const result = markersSignal.evaluate(events, cleanEnvironment);
    expect(result.id).toBe("markers");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBe(0.99);
    expect(result.weight).toBe(3);
    expect(result.agent).toBe("claude-in-chrome");
    expect(result.reasons.join(" ")).toContain("#claude-agent-glow-border");
  });

  it("chatgpt overlay names chatgpt-agent", () => {
    const events: EvidenceEvent[] = [
      { kind: "move", t: 1000.5, x: 10, y: 20, pointer: "mouse" },
      { kind: "marker", t: 1010.5, agent: "chatgpt-agent", marker: "#codex-agent-overlay-root" },
    ];
    const result = markersSignal.evaluate(events, cleanEnvironment);
    expect(result.agentLikelihood).toBe(0.99);
    expect(result.agent).toBe("chatgpt-agent");
    expect(result.reasons.join(" ")).toContain("#codex-agent-overlay-root");
  });

  it("unknown added elements are ignored", () => {
    const events: EvidenceEvent[] = [
      { kind: "move", t: 1000.5, x: 10, y: 20, pointer: "mouse" },
      { kind: "scroll", t: 1100.5, trusted: true },
    ];
    const result = markersSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable).toBe(false);
    expect(result.agent).toBeUndefined();
  });

  it("lists exactly the known marker selectors", () => {
    expect(KNOWN_MARKERS).toEqual([
      { agent: "claude-in-chrome", selector: "#claude-agent-glow-border" },
      { agent: "claude-in-chrome", selector: "#claude-phantom-cursor" },
      { agent: "claude-in-chrome", selector: "#claude-agent-animation-styles" },
      { agent: "chatgpt-agent", selector: "#codex-agent-overlay-root" },
    ]);
  });
});

describe("markersSignal exactness", () => {
  it("a marker event outside the known list is ignored", () => {
    const events: EvidenceEvent[] = [
      { kind: "marker", t: 1000.5, agent: "claude-in-chrome", marker: "#claude-something-new" },
    ];
    expect(markersSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });
});
