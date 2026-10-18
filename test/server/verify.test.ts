import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/core/clock";
import { buildSummary } from "../../src/core/summary";
import { issueToken, memoryTokenStore } from "../../src/server/tokens";
import { verifySubmission } from "../../src/server/verify";
import { fixtureNamed } from "../fixtures";

const secret = "a-test-secret-that-is-long-enough-1234";

function manualClock(start: number): { clock: Clock; advance: (ms: number) => void } {
  let now = start;
  return { clock: () => now, advance: (ms) => (now += ms) };
}

async function summaryFor(fixtureId: string, clock: Clock, ttlMs?: number): Promise<string> {
  const fixture = fixtureNamed(fixtureId);
  return buildSummary(fixture.events, fixture.env, await issueToken(secret, clock, ttlMs));
}

describe("verifySubmission", () => {
  it("fresh token is accepted once then replayed", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("human-desktop-001", clock);

    const first = await verifySubmission({ summary, secret, store, mode: "block", clock });
    const second = await verifySubmission({ summary, secret, store, mode: "block", clock });

    expect(first).toMatchObject({ allowed: true, reason: "ok" });
    expect(second).toMatchObject({ allowed: false, reason: "replayed" });
  });

  it("expired token is rejected", async () => {
    const { clock, advance } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("human-desktop-001", clock, 1000);
    advance(1000);

    const result = await verifySubmission({ summary, secret, store, mode: "block", clock });

    expect(result).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("tampered token is rejected", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const fixture = fixtureNamed("human-desktop-001");
    const token = await issueToken(secret, clock);
    const [id, expiry, signature] = token.split(".") as [string, string, string];
    const summary = buildSummary(fixture.events, fixture.env, `${id}.${Number(expiry) + 60000}.${signature}`);

    const result = await verifySubmission({ summary, secret, store, mode: "block", clock });

    expect(result).toMatchObject({ allowed: false, reason: "bad-token" });
  });

  it("detect mode always allows but reports agent", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("claude-in-chrome-001", clock);

    const result = await verifySubmission({ summary, secret, store, mode: "detect", clock });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("agent");
    expect(result.verdict.kind).toBe("agent");
  });

  it("detect mode allows bad tokens and missing summaries", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const fixture = fixtureNamed("human-desktop-001");

    const missing = await verifySubmission({ summary: null, secret, store, mode: "detect", clock });
    const badToken = await verifySubmission({
      summary: buildSummary(fixture.events, fixture.env, "forged.1.token"),
      secret,
      store,
      mode: "detect",
      clock,
    });

    expect(missing).toMatchObject({ allowed: true, reason: "missing" });
    expect(badToken).toMatchObject({ allowed: true, reason: "bad-token" });
  });

  it("block mode rejects missing summary by default", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const fixture = fixtureNamed("human-desktop-001");

    const absent = await verifySubmission({ summary: null, secret, store, mode: "block", clock });
    const blank = await verifySubmission({ summary: "", secret, store, mode: "block", clock });
    const tokenless = await verifySubmission({
      summary: buildSummary(fixture.events, fixture.env, null),
      secret,
      store,
      mode: "block",
      clock,
    });

    for (const result of [absent, blank, tokenless]) {
      expect(result).toMatchObject({ allowed: false, reason: "missing" });
      expect(result.verdict.kind).toBe("unsure");
    }
  });

  it("missing: allow lets it through", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);

    const result = await verifySubmission({ summary: null, secret, store, mode: "block", missing: "allow", clock });

    expect(result).toMatchObject({ allowed: true, reason: "missing" });
  });

  it("unparsable summary is rejected in block mode even when missing summaries are allowed", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);

    const defaults = await verifySubmission({ summary: "not a summary", secret, store, mode: "block", clock });
    const lenient = await verifySubmission({
      summary: "not a summary",
      secret,
      store,
      mode: "block",
      missing: "allow",
      clock,
    });

    expect(defaults).toMatchObject({ allowed: false, reason: "bad-summary" });
    expect(lenient).toMatchObject({ allowed: false, reason: "bad-summary" });
    expect(lenient.verdict.kind).toBe("unsure");
  });

  it("unparsable summary is allowed but reported in detect mode", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);

    const result = await verifySubmission({ summary: "not a summary", secret, store, mode: "detect", clock });

    expect(result).toMatchObject({ allowed: true, reason: "bad-summary" });
  });

  it("concurrent submissions of one token yield exactly one ok", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("human-desktop-001", clock);

    const results = await Promise.all([
      verifySubmission({ summary, secret, store, mode: "block", clock }),
      verifySubmission({ summary, secret, store, mode: "block", clock }),
    ]);

    expect(results.map((result) => result.reason).sort()).toEqual(["ok", "replayed"]);
  });

  it("short secret fails on every path", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);

    await expect(verifySubmission({ summary: null, secret: "short", store, mode: "detect", clock })).rejects.toThrow(
      /at least 32 bytes/,
    );
    await expect(
      verifySubmission({
        summary: null,
        secret: "short",
        store,
        mode: "block",
        clock,
        verifiedAgent: "chatgpt-agent",
        allow: ["chatgpt-agent"],
      }),
    ).rejects.toThrow(/at least 32 bytes/);
  });

  it("agent fixture summary is rejected in block mode", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("chatgpt-agent-001", clock);

    const result = await verifySubmission({ summary, secret, store, mode: "block", clock });

    expect(result).toMatchObject({ allowed: false, reason: "agent" });
    expect(result.verdict.kind).toBe("agent");
  });

  it("human fixture summary is allowed", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("human-desktop-001", clock);

    const result = await verifySubmission({ summary, secret, store, mode: "block", clock });

    expect(result).toMatchObject({ allowed: true, reason: "ok" });
    expect(result.verdict.kind).not.toBe("agent");
  });

  it("a marker on a clearly human session is allowed in block mode and reported in detect mode", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const human = fixtureNamed("human-desktop-001");
    const marker = { kind: "marker" as const, t: 1000.5, agent: "claude-in-chrome", marker: "#claude-phantom-cursor" };
    const events = [marker, ...human.events.slice(-299)];
    const blockSummary = buildSummary(events, human.env, await issueToken(secret, clock));
    const detectSummary = buildSummary(events, human.env, await issueToken(secret, clock));

    const blocking = await verifySubmission({ summary: blockSummary, secret, store, mode: "block", clock });
    const detecting = await verifySubmission({ summary: detectSummary, secret, store, mode: "detect", clock });

    expect(blocking).toMatchObject({ allowed: true, reason: "ok", verdict: { kind: "unsure" } });
    expect(detecting).toMatchObject({ allowed: true, reason: "agent", verdict: { kind: "agent", agent: "claude-in-chrome" } });
  });

  it("verified allow-listed agent is allowed", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("chatgpt-agent-001", clock);

    const result = await verifySubmission({
      summary,
      secret,
      store,
      mode: "block",
      clock,
      verifiedAgent: "chatgpt-agent",
      allow: ["chatgpt-agent"],
    });

    expect(result).toMatchObject({ allowed: true, reason: "allowed-agent" });
    expect(result.verdict).toMatchObject({ kind: "agent", agent: "chatgpt-agent" });
  });

  it("a verified agent not on the allow list is still scored", async () => {
    const { clock } = manualClock(1_000_000.5);
    const store = memoryTokenStore(clock);
    const summary = await summaryFor("chatgpt-agent-001", clock);

    const result = await verifySubmission({
      summary,
      secret,
      store,
      mode: "block",
      clock,
      verifiedAgent: "other-agent",
      allow: ["chatgpt-agent"],
    });

    expect(result).toMatchObject({ allowed: false, reason: "agent" });
  });
});
