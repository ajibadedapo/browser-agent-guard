import { describe, expect, it } from "vitest";
import { buildSummary, parseSummary, SUMMARY_EVENT_LIMIT } from "../../src/core/summary";
import type { Environment, EvidenceEvent } from "../../src/core/types";
import { fixtureNamed } from "../fixtures";

const cleanEnv: Environment = { webdriver: false, automationTraces: [] };

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

describe("summary", () => {
  it("summary round-trips and is capped at 300 events", () => {
    const events: EvidenceEvent[] = Array.from({ length: 450 }, (_, index) => ({
      kind: "scroll",
      t: 1000.5 + index,
      trusted: true,
    }));
    const env: Environment = { webdriver: true, automationTraces: ["__pwInitScripts"] };

    const summary = buildSummary(events, env, "token-1");

    expect(summary).toMatch(/^[A-Za-z0-9_-]+$/);
    const parsed = parseSummary(summary);
    expect(parsed?.events).toHaveLength(SUMMARY_EVENT_LIMIT);
    expect(parsed?.events[0]?.t).toBe(1150.5);
    expect(parsed?.events).toEqual(events.slice(-SUMMARY_EVENT_LIMIT));
    expect(parsed?.env).toEqual(env);
    expect(parsed?.token).toBe("token-1");
  });

  it("round-trips a recorded fixture session", () => {
    const fixture = fixtureNamed("claude-in-chrome-001");

    const parsed = parseSummary(buildSummary(fixture.events, fixture.env, null));

    expect(parsed).toEqual({ events: fixture.events.slice(-SUMMARY_EVENT_LIMIT), env: fixture.env, token: null });
  });

  it.each([
    ["empty", ""],
    ["not base64url", "abc+/="],
    ["not json", Buffer.from("not json").toString("base64url")],
    ["wrong version", encode({ v: 2, events: [], env: cleanEnv, token: null })],
    ["too many events", encode({ v: 1, events: Array.from({ length: 301 }, () => ({ kind: "scroll", t: 1.5, trusted: true })), env: cleanEnv, token: null })],
    ["unknown event kind", encode({ v: 1, events: [{ kind: "value", t: 1.5, text: "secret" }], env: cleanEnv, token: null })],
    ["click without rect", encode({ v: 1, events: [{ kind: "click", t: 1.5, x: 1, y: 1, pointer: "mouse", trusted: true }], env: cleanEnv, token: null })],
    ["bad field kind", encode({ v: 1, events: [{ kind: "paste", t: 1.5, trusted: true, field: "password" }], env: cleanEnv, token: null })],
    ["bad environment", encode({ v: 1, events: [], env: { webdriver: "no", automationTraces: [] }, token: null })],
    ["numeric token", encode({ v: 1, events: [], env: cleanEnv, token: 5 })],
  ])("rejects %s", (_label, encoded) => {
    expect(parseSummary(encoded)).toBeNull();
  });
});
