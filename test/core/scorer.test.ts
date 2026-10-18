import { describe, expect, it } from "vitest";
import { evaluate, score } from "../../src/core/scorer";
import { defaultSignals } from "../../src/signals";
import type { Environment, EvidenceEvent, SignalResult } from "../../src/core/types";
import { loadFixtures } from "../fixtures";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

function result(id: string, agentLikelihood: number, weight = 1, extra: Partial<SignalResult> = {}): SignalResult {
  return { id, applicable: true, agentLikelihood, weight, reasons: [`${id} reason`], ...extra };
}

function notApplicable(id: string): SignalResult {
  return { id, applicable: false, agentLikelihood: 0, weight: 1, reasons: [`${id} not applicable`] };
}

function humanMouseClicksWithMovement(start: number): EvidenceEvent[] {
  return [0, 1, 2].flatMap((clickIndex) => {
    const clickTime = start + clickIndex * 3000;
    const moves: EvidenceEvent[] = Array.from({ length: 20 }, (_, moveIndex) => ({
      kind: "move",
      t: clickTime - 900 + moveIndex * 40,
      x: 40 + moveIndex * 5,
      y: 60 + moveIndex * 3,
      pointer: "mouse",
    }));
    const click: EvidenceEvent = {
      kind: "click",
      t: clickTime,
      x: 172,
      y: 133,
      pointer: "mouse",
      trusted: true,
      rect: { x: 100, y: 100, w: 100, h: 40 },
    };
    return [...moves, click];
  });
}

function voiceControlSession(start: number): EvidenceEvent[] {
  const clicks: EvidenceEvent[] = Array.from({ length: 6 }, (_, index) => ({
    kind: "click",
    t: start + index * 2500,
    x: 150,
    y: 120,
    pointer: "mouse",
    trusted: true,
    rect: { x: 100, y: 100, w: 100, h: 40 },
  }));
  const dictation: EvidenceEvent[] = [0, 1].map((index) => ({
    kind: "input",
    t: start + 1200 + index * 5000,
    trusted: true,
    inputType: "insertText",
    length: 24,
    field: "text",
  }));
  return [...clicks, ...dictation].sort((a, b) => a.t - b.t);
}

function androidTouchDropdownSession(start: number): EvidenceEvent[] {
  const typedName: EvidenceEvent[] = [0, 1, 2, 3].flatMap((index) => {
    const t = start + index * 220;
    return [
      { kind: "key", t, trusted: true, printable: false, modifier: null },
      { kind: "input", t: t + 2, trusted: true, inputType: "insertText", length: index + 1, field: "text" },
    ];
  });
  const chooseFromDropdown = (t: number): EvidenceEvent[] => [
    { kind: "move", t: t - 30, x: 120, y: 340, pointer: "touch" },
    { kind: "down", t, x: 120, y: 340, pointer: "touch", trusted: true, rect: { x: 20, y: 320, w: 300, h: 40 } },
    { kind: "click", t: t + 40, x: 120, y: 340, pointer: "touch", trusted: true, rect: { x: 20, y: 320, w: 300, h: 40 } },
    { kind: "input", t: t + 50, trusted: false, inputType: null, length: 7, field: "text" },
    { kind: "change", t: t + 52, trusted: false, field: "text" },
  ];
  return [...typedName, ...chooseFromDropdown(start + 2000), ...chooseFromDropdown(start + 6000)].sort((a, b) => a.t - b.t);
}

function quantityStepperHoldSession(start: number): EvidenceEvent[] {
  const holdEnter = (t: number): EvidenceEvent[] => [
    { kind: "key", t, trusted: true, printable: false, modifier: null },
    { kind: "click", t: t + 1, x: 0, y: 0, pointer: "keyboard", trusted: true, rect: { x: 400, y: 200, w: 32, h: 32 } },
    { kind: "input", t: t + 3, trusted: false, inputType: null, length: 1, field: "text" },
    { kind: "input", t: t + 36, trusted: false, inputType: null, length: 1, field: "text" },
  ];
  return [...holdEnter(start), ...holdEnter(start + 5000)];
}

describe("score", () => {
  it("no evidence is unsure", () => {
    const verdict = score([notApplicable("pointer-path"), notApplicable("typing-rhythm")]);
    expect(verdict).toEqual({ kind: "unsure", confidence: 0, reasons: [] });
    expect(score([])).toEqual({ kind: "unsure", confidence: 0, reasons: [] });
  });

  it("single behavioural signal never yields agent", () => {
    for (const id of ["synthetic-input", "typing-rhythm", "pointer-path", "click-precision", "session-rhythm", "environment"]) {
      const verdict = score([result(id, 0.99, 5), notApplicable("markers")]);
      expect(verdict.kind).toBe("unsure");
      expect(verdict.confidence).toBeLessThan(0.5);
    }
  });

  it("the same signal id reported twice is not two independent signals", () => {
    const verdict = score([result("pointer-path", 0.95), result("pointer-path", 0.95)]);
    expect(verdict.kind).toBe("unsure");
  });

  it("marker alone yields named agent", () => {
    const verdict = score([
      result("markers", 0.99, 3, { agent: "claude-in-chrome", reasons: ["page contains claude-in-chrome marker"] }),
      notApplicable("pointer-path"),
    ]);
    expect(verdict.kind).toBe("agent");
    expect(verdict.agent).toBe("claude-in-chrome");
    expect(verdict.confidence).toBeCloseTo(0.99);
    expect(verdict.reasons).toEqual(["page contains claude-in-chrome marker"]);
  });

  it("marker plus strong human evidence still yields the named agent", () => {
    const verdict = score([
      result("markers", 0.99, 3, { agent: "chatgpt-agent" }),
      result("synthetic-input", 0.05, 2),
      result("typing-rhythm", 0.1),
      result("pointer-path", 0.1),
      result("click-precision", 0.1),
    ]);
    expect(verdict.kind).toBe("agent");
    expect(verdict.agent).toBe("chatgpt-agent");
    expect(verdict.confidence).toBeCloseTo(0.99);
  });

  it("in block mode a marker with clearly human behaviour is unsure, and detect mode still names the agent", () => {
    const results = [
      result("markers", 0.99, 3, { agent: "claude-in-chrome", reasons: ["page contains claude-in-chrome marker"] }),
      result("synthetic-input", 0.05, 2),
      result("pointer-path", 0.1),
    ];
    const blocking = score(results, { mode: "block" });
    expect(blocking.kind).toBe("unsure");
    expect(blocking.agent).toBeUndefined();
    expect(blocking.reasons).toContain("page contains claude-in-chrome marker");
    expect(score(results, { mode: "detect" })).toMatchObject({ kind: "agent", agent: "claude-in-chrome" });
  });

  it("in block mode a marker still decides agent when behaviour is not clearly human", () => {
    const markerOnly = [result("markers", 0.99, 3, { agent: "chatgpt-agent" }), notApplicable("pointer-path")];
    const mixed = [result("markers", 0.99, 3, { agent: "chatgpt-agent" }), result("synthetic-input", 0.95, 2), result("pointer-path", 0.1)];
    expect(score(markerOnly, { mode: "block" })).toMatchObject({ kind: "agent", agent: "chatgpt-agent" });
    expect(score(mixed, { mode: "block" })).toMatchObject({ kind: "agent", agent: "chatgpt-agent" });
  });

  it("marker decides agent even when a custom threshold is above its likelihood", () => {
    const verdict = score([result("markers", 0.99, 3, { agent: "claude-in-chrome" })], { agentThreshold: 0.995 });
    expect(verdict.kind).toBe("agent");
    expect(verdict.agent).toBe("claude-in-chrome");
  });

  it("environment plus one other behavioural signal at threshold yields agent", () => {
    const verdict = score([result("environment", 0.95, 2), result("pointer-path", 0.8)]);
    expect(verdict.kind).toBe("agent");
    expect(verdict.agent).toBeUndefined();
  });

  it("two agreeing signals in the same group count once", () => {
    const pointerOnly = [
      result("pointer-path", 0.95, 1, { group: "pointer" }),
      result("click-precision", 0.95, 1, { group: "pointer" }),
    ];
    expect(score(pointerOnly).kind).toBe("unsure");
  });

  it("a grouped signal and an ungrouped signal agreeing yield agent", () => {
    const verdict = score([
      result("pointer-path", 0.9, 1, { group: "pointer" }),
      result("click-precision", 0.9, 1, { group: "pointer" }),
      result("synthetic-input", 0.95, 2),
    ]);
    expect(verdict.kind).toBe("agent");
    expect(verdict.confidence).toBeCloseTo((0.9 + 0.9 + 0.95 * 2) / 4);
  });

  it("a signal without a group is not merged with a group of the same name", () => {
    const verdict = score([result("pointer", 0.95), result("click-precision", 0.95, 1, { group: "pointer" })]);
    expect(verdict.kind).toBe("agent");
  });

  it("zero-weight results are no evidence", () => {
    const verdict = score([result("pointer-path", 0.95, 0), result("click-precision", 0.95, 0)]);
    expect(verdict).toEqual({ kind: "unsure", confidence: 0, reasons: [] });
  });

  it("two independent behavioural signals agreeing yield an unnamed agent", () => {
    const verdict = score([result("synthetic-input", 0.95, 2), result("pointer-path", 0.85)]);
    expect(verdict.kind).toBe("agent");
    expect(verdict.agent).toBeUndefined();
    expect(verdict.confidence).toBeCloseTo((0.95 * 2 + 0.85) / 3);
    expect(verdict.reasons).toEqual(["synthetic-input reason", "pointer-path reason"]);
  });

  it("two agreeing signals outweighed by human evidence are not agent", () => {
    const verdict = score([
      result("synthetic-input", 0.9),
      result("pointer-path", 0.9),
      result("click-precision", 0.1),
      result("typing-rhythm", 0.1),
    ]);
    expect(verdict.kind).toBe("unsure");
  });

  it("low weighted mean with behavioural evidence is human", () => {
    const verdict = score([result("synthetic-input", 0.05, 2), result("pointer-path", 0.1), notApplicable("markers")]);
    expect(verdict.kind).toBe("human");
    expect(verdict.agent).toBeUndefined();
    expect(verdict.confidence).toBeCloseTo(1 - (0.05 * 2 + 0.1) / 3);
    expect(verdict.reasons).toEqual(["synthetic-input reason", "pointer-path reason"]);
  });

  it("custom thresholds change the verdict", () => {
    const results = [result("synthetic-input", 0.7), result("pointer-path", 0.7)];
    expect(score(results).kind).toBe("unsure");
    expect(score(results, { agentThreshold: 0.6 }).kind).toBe("agent");
    expect(score([result("pointer-path", 0.4)], { humanThreshold: 0.5 }).kind).toBe("human");
  });

  it("reasons skip results that are not applicable", () => {
    const verdict = score([result("pointer-path", 0.5), notApplicable("typing-rhythm")]);
    expect(verdict.reasons).toEqual(["pointer-path reason"]);
  });
});

describe("evaluate", () => {
  it("a single strong synthetic-input result with human pointer evidence is not agent", () => {
    const events: EvidenceEvent[] = [
      ...humanMouseClicksWithMovement(2000.5),
      { kind: "input", t: 9000.5, trusted: false, inputType: null, length: 21, field: "text" },
      { kind: "change", t: 9000.5, trusted: false, field: "text" },
    ];
    const results = defaultSignals.map((signal) => signal.evaluate(events, cleanEnvironment));
    const synthetic = results.find((candidate) => candidate.id === "synthetic-input");
    expect(synthetic?.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    const verdict = evaluate(events, cleanEnvironment);
    expect(verdict.kind).not.toBe("agent");
  });

  it("a voice control session with centred clicks, no moves and dictated text is not agent", () => {
    const events = voiceControlSession(2000.5);
    const results = defaultSignals.map((signal) => signal.evaluate(events, cleanEnvironment));
    const pointerResults = results.filter((candidate) => ["pointer-path", "click-precision"].includes(candidate.id));
    expect(pointerResults).toHaveLength(2);
    for (const pointerResult of pointerResults) {
      expect(pointerResult.applicable).toBe(true);
      expect(pointerResult.agentLikelihood).toBeGreaterThanOrEqual(0.8);
    }
    expect(results.filter((candidate) => candidate.applicable && candidate.agentLikelihood >= 0.8)).toHaveLength(2);
    expect(evaluate(events, cleanEnvironment).kind).not.toBe("agent");
  });

  it("pointer-path and click-precision share the pointer group", () => {
    const events = voiceControlSession(2000.5);
    const groups = defaultSignals
      .map((signal) => signal.evaluate(events, cleanEnvironment))
      .filter((candidate) => candidate.group === "pointer")
      .map((candidate) => candidate.id);
    expect(groups.sort()).toEqual(["click-precision", "pointer-path"]);
  });

  it("an Android touch user choosing from two scripted dropdowns is not agent", () => {
    const events = androidTouchDropdownSession(2000.5);
    const results = defaultSignals.map((signal) => signal.evaluate(events, cleanEnvironment));
    const agreeing = results.filter((candidate) => candidate.applicable && candidate.agentLikelihood >= 0.8);
    expect(agreeing.map((candidate) => candidate.id).sort()).toEqual(["session-rhythm", "synthetic-input"]);
    expect(evaluate(events, cleanEnvironment).kind).not.toBe("agent");
  });

  it("a keyboard user holding Enter on a scripted quantity stepper is not agent", () => {
    const events = quantityStepperHoldSession(2000.5);
    const results = defaultSignals.map((signal) => signal.evaluate(events, cleanEnvironment));
    const agreeing = results.filter((candidate) => candidate.applicable && candidate.agentLikelihood >= 0.8);
    expect(agreeing.map((candidate) => candidate.id).sort()).toEqual(["session-rhythm", "synthetic-input"]);
    expect(evaluate(events, cleanEnvironment).kind).not.toBe("agent");
  });

  it("synthetic-input and session-rhythm share the synthetic group", () => {
    const events = quantityStepperHoldSession(2000.5);
    const groups = defaultSignals
      .map((signal) => signal.evaluate(events, cleanEnvironment))
      .filter((candidate) => candidate.group === "synthetic")
      .map((candidate) => candidate.id);
    expect(groups.sort()).toEqual(["session-rhythm", "synthetic-input"]);
  });

  it("uses the signals it is given", () => {
    const verdict = evaluate([], cleanEnvironment, [
      { id: "always-agent", evaluate: () => result("always-agent", 0.99) },
      { id: "also-agent", evaluate: () => result("also-agent", 0.99) },
    ]);
    expect(verdict.kind).toBe("agent");
  });

  it("before any interaction the verdict is unsure", () => {
    expect(evaluate([], cleanEnvironment).kind).toBe("unsure");
  });

  describe("fixtures", () => {
    for (const fixture of loadFixtures()) {
      it(`${fixture.id} scores as ${fixture.label}`, () => {
        const verdict = evaluate(fixture.events, fixture.env);
        if (fixture.label === "agent") {
          expect(verdict.kind).toBe("agent");
          const hasMarkers = fixture.events.some((event) => event.kind === "marker");
          expect(verdict.agent).toBe(hasMarkers ? fixture.agent : undefined);
        } else {
          expect(["human", "unsure"]).toContain(verdict.kind);
        }
      });
    }
  });
});
