import { describe, expect, it } from "vitest";
import { syntheticInputSignal } from "../../src/signals/synthetic-input";
import type { Environment, EvidenceEvent } from "../../src/core/types";
import { fixtureNamed } from "../fixtures";

const cleanEnvironment: Environment = { webdriver: false, automationTraces: [] };

describe("syntheticInputSignal", () => {
  it("chatgpt fixture is synthetic", () => {
    const fixture = fixtureNamed("chatgpt-agent-nomarkers-001");
    const result = syntheticInputSignal.evaluate(fixture.events, fixture.env);
    expect(result.id).toBe("synthetic-input");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons.join(" ")).toContain("untrusted paste");
  });

  it("human fixture is not synthetic", () => {
    const fixture = fixtureNamed("human-desktop-001");
    const result = syntheticInputSignal.evaluate(fixture.events, fixture.env);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeLessThanOrEqual(0.1);
  });

  it("cmd-v paste is human", () => {
    const events: EvidenceEvent[] = [
      { kind: "key", t: 1000.5, trusted: true, printable: false, modifier: "meta" },
      { kind: "key", t: 1080.5, trusted: true, printable: true, modifier: "meta" },
      { kind: "paste", t: 1090.5, trusted: true, field: "text" },
      { kind: "input", t: 1091.5, trusted: true, inputType: "insertFromPaste", length: 24, field: "text" },
    ];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBeLessThanOrEqual(0.1);
    expect(result.reasons.join(" ")).toContain("keyboard shortcut");
  });

  it("text that changes with no key or paste before it is synthetic", () => {
    const events: EvidenceEvent[] = [
      { kind: "key", t: 1000.5, trusted: true, printable: true, modifier: null },
      { kind: "input", t: 1600.5, trusted: false, inputType: null, length: 14, field: "text" },
    ];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons.join(" ")).toContain("14 characters");
  });

  it("an untrusted change on a select is synthetic", () => {
    const events: EvidenceEvent[] = [{ kind: "change", t: 1000.5, trusted: false, field: "select" }];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
  });

  it("password manager fill on credential fields is not synthetic", () => {
    const events: EvidenceEvent[] = [
      { kind: "input", t: 1000.5, trusted: false, inputType: null, length: 18, field: "credential" },
      { kind: "change", t: 1000.5, trusted: false, field: "credential" },
      { kind: "input", t: 1001.5, trusted: false, inputType: null, length: 16, field: "credential" },
      { kind: "paste", t: 1002.5, trusted: false, field: "credential" },
    ];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.agentLikelihood).toBeLessThanOrEqual(0.1);
  });

  it("no text entry is not applicable", () => {
    const events: EvidenceEvent[] = [{ kind: "scroll", t: 1000.5, trusted: true }];
    expect(syntheticInputSignal.evaluate(events, cleanEnvironment).applicable).toBe(false);
  });
});

describe("syntheticInputSignal untrusted input after a key", () => {
  it("an untrusted text input is synthetic even right after a trusted key", () => {
    const events: EvidenceEvent[] = [
      { kind: "key", t: 1000.5, trusted: true, printable: true, modifier: null },
      { kind: "input", t: 1001.5, trusted: false, inputType: null, length: 9, field: "text" },
    ];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.agentLikelihood).toBeGreaterThanOrEqual(0.9);
    expect(result.reasons.join(" ")).toContain("untrusted input");
  });

  it("a trusted text change with no key or paste before it is neutral", () => {
    const events: EvidenceEvent[] = [
      { kind: "input", t: 1000.5, trusted: true, inputType: "insertText", length: 11, field: "text" },
    ];
    const result = syntheticInputSignal.evaluate(events, cleanEnvironment);
    expect(result.applicable).toBe(false);
    expect(result.reasons.join(" ")).toContain("neutral");
  });
});
