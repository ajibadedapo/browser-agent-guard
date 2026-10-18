import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/core/clock";
import { handleTokenRequest, issueToken, memoryTokenStore, readToken } from "../../src/server/tokens";

const secret = "a-test-secret-that-is-long-enough-1234";

function manualClock(start: number): { clock: Clock; advance: (ms: number) => void } {
  let now = start;
  return { clock: () => now, advance: (ms) => (now += ms) };
}

describe("tokens", () => {
  it("issues a token that reads back with its expiry", async () => {
    const { clock } = manualClock(1_000_000.5);

    const token = await issueToken(secret, clock, 5000);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+$/);
    const read = await readToken(token, secret);
    expect(read?.expiresAt).toBe(1_005_000);
    expect(read?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("issues a different id every time", async () => {
    const { clock } = manualClock(1000.5);

    const first = await issueToken(secret, clock);
    const second = await issueToken(secret, clock);

    expect(first).not.toBe(second);
  });

  it("tampered token is rejected", async () => {
    const { clock } = manualClock(1000.5);
    const token = await issueToken(secret, clock);
    const [id, expiry, signature] = token.split(".") as [string, string, string];
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;

    expect(await readToken(`${id}.${Number(expiry) + 1}.${signature}`, secret)).toBeNull();
    expect(await readToken(`${id}.${expiry}.${flipped}`, secret)).toBeNull();
    expect(await readToken(token, "a-different-secret-that-is-long-enough")).toBeNull();
    expect(await readToken("not-a-token", secret)).toBeNull();
    expect(await readToken("", secret)).toBeNull();
  });

  it("rejects secrets shorter than 32 bytes", async () => {
    await expect(issueToken("short")).rejects.toThrow(/at least 32 bytes/);
    await expect(readToken("a.1.b", "short")).rejects.toThrow(/at least 32 bytes/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects ttlMs %s", async (ttlMs) => {
    await expect(issueToken(secret, () => 1000.5, ttlMs)).rejects.toThrow(/ttlMs must be a finite number greater than 0/);
  });

  it("memory store stays bounded under steady traffic", async () => {
    const { clock, advance } = manualClock(1000.5);
    const store = memoryTokenStore(clock);
    const ttlMs = 1000;
    const stepMs = 10;
    let largest = 0;

    for (let index = 0; index < 5000; index += 1) {
      expect(await store.consume(`id-${index}`, Math.floor(clock() + ttlMs))).toBe(true);
      largest = Math.max(largest, store.size());
      advance(stepMs);
    }

    expect(largest).toBeLessThanOrEqual(ttlMs / stepMs + 1);
  });

  it("memory store accepts an id once", async () => {
    const { clock } = manualClock(1000.5);
    const store = memoryTokenStore(clock);

    expect(await store.consume("id-1", 5000)).toBe(true);
    expect(await store.consume("id-1", 5000)).toBe(false);
    expect(await store.consume("id-2", 5000)).toBe(true);
  });

  it("memory store refuses already expired ids", async () => {
    const { clock } = manualClock(6000.5);
    const store = memoryTokenStore(clock);

    expect(await store.consume("id-1", 5000)).toBe(false);
  });

  it("memory store drops expired entries", async () => {
    const { clock, advance } = manualClock(1000.5);
    const store = memoryTokenStore(clock);
    await store.consume("id-1", 2000);
    await store.consume("id-2", 9000);
    expect(store.size()).toBe(2);

    advance(1500);
    await store.consume("id-3", 9000);

    expect(store.size()).toBe(2);
  });
});

describe("handleTokenRequest", () => {
  it("returns a fresh token as uncached JSON for POST", async () => {
    const response = await handleTokenRequest(new Request("https://example.test/token", { method: "POST" }), secret);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    const body = (await response.json()) as { token: string };
    expect(await readToken(body.token, secret)).not.toBeNull();
  });

  it("rejects other methods with 405", async () => {
    const response = await handleTokenRequest(new Request("https://example.test/token"), secret);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
