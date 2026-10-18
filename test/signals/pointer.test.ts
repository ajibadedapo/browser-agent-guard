import { describe, expect, it } from "vitest";
import { clickPrecisionSignal } from "../../src/signals/click-precision";
import { pointerPathSignal } from "../../src/signals/pointer-path";
import type { Environment, EvidenceEvent, PointerKind } from "../../src/core/types";
import { fixtureNamed } from "../fixtures";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

function centredClick(t: number, pointer: PointerKind): EvidenceEvent {
  return { kind: "click", t, x: 150, y: 120, pointer, trusted: true, rect: { x: 100, y: 100, w: 100, h: 40 } };
}

describe("pointerPathSignal", () => {
  it("claude and chatgpt fixtures teleport", () => {
    for (const id of ["claude-in-chrome-nomarkers-001", "chatgpt-agent-nomarkers-001"]) {
      const fixture = fixtureNamed(id);
      const result = pointerPathSignal.evaluate(fixture.events, fixture.env);
      expect(result.id).toBe("pointer-path");
      expect(result.applicable).toBe(true);
      expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.8);
      expect(result.reasons.join(" ")).toMatch(/median \d+(\.\d+)? pointer moves/);
    }
  });

  it("human fixture moves", () => {
    const fixture = fixtureNamed("human-desktop-001");
    const result = pointerPathSignal.evaluate(fixture.events, fixture.env);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeLessThanOrEqual(0.2);
  });

  it("clicks within 50 ms of each other count as one decision", () => {
    const events: EvidenceEvent[] = [centredClick(1000.5, "mouse"), centredClick(1000.5, "mouse"), centredClick(3000.5, "mouse")];
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("only moves in the second before a click count", () => {
    const moves: EvidenceEvent[] = Array.from({ length: 20 }, (_, index) => ({
      kind: "move",
      t: 500.5 + index * 10,
      x: index,
      y: index,
      pointer: "mouse",
    }));
    const events = [...moves, centredClick(2000.5, "mouse"), centredClick(4000.5, "mouse"), centredClick(6000.5, "mouse")];
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).agentLikelihood).toBeGreaterThanOrEqual(0.8);
  });
});

describe("clickPrecisionSignal", () => {
  it("centred mouse clicks are agent-like", () => {
    const events = [centredClick(1000.5, "mouse"), centredClick(2000.5, "mouse"), centredClick(3000.5, "mouse")];
    const result = clickPrecisionSignal.evaluate(events, cleanEnvironment);
    expect(result.id).toBe("click-precision");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons.join(" ")).toContain("from the centre");
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).agentLikelihood).toBeGreaterThanOrEqual(0.8);
  });

  it("human fixture clicks are off centre", () => {
    const fixture = fixtureNamed("human-desktop-001");
    expect(clickPrecisionSignal.evaluate(fixture.events, fixture.env).agentLikelihood).toBeLessThanOrEqual(0.2);
  });

  it("agent fixtures click near the centre", () => {
    for (const id of ["claude-in-chrome-nomarkers-001", "chatgpt-agent-nomarkers-001"]) {
      const fixture = fixtureNamed(id);
      expect(clickPrecisionSignal.evaluate(fixture.events, fixture.env).agentLikelihood).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("touch taps are not applicable", () => {
    const events = [1000.5, 2000.5, 3000.5, 4000.5, 5000.5].map((t) => centredClick(t, "touch"));
    expect(clickPrecisionSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("keyboard activated clicks are not applicable", () => {
    const events = [1000.5, 2000.5, 3000.5, 4000.5].map((t) => centredClick(t, "keyboard"));
    expect(clickPrecisionSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });

  it("keyboard-only session is not applicable", () => {
    const events: EvidenceEvent[] = [1000.5, 1200.5, 1400.5, 1600.5].map((t) => ({
      kind: "key",
      t,
      trusted: true,
      printable: false,
      modifier: null,
    }));
    expect(clickPrecisionSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
    expect(pointerPathSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });
});
