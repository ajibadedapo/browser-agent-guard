import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentKeyResolver, fetchKeyDirectory, verifyAgentRequest } from "../../src/server/web-bot-auth";

const createdSeconds = 1760000000;
const clockAtCreation = () => createdSeconds * 1000 + 1000.5;
const agentUrl = "https://chatgpt.com";

interface SignedRequestOptions {
  privateKey: CryptoKey;
  keyId?: string;
  url?: string;
  created?: number;
  expires?: number;
  tag?: string;
  signatureAgentHeader?: string | null;
  components?: string[];
  componentLines?: (url: URL) => string[];
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function signedRequest(options: SignedRequestOptions): Promise<Request> {
  const url = new URL(options.url ?? "https://shop.example/checkout?step=2");
  const keyId = options.keyId ?? "test-key";
  const created = options.created ?? createdSeconds;
  const expires = options.expires ?? createdSeconds + 300;
  const tag = options.tag ?? "web-bot-auth";
  const signatureAgentHeader =
    options.signatureAgentHeader === undefined ? `sig1="${agentUrl}"` : options.signatureAgentHeader;
  const components = options.components ?? ['"@authority"', '"signature-agent";key="sig1"'];
  const lines = options.componentLines
    ? options.componentLines(url)
    : [`"@authority": ${url.host}`, `"signature-agent";key="sig1": "${agentUrl}"`];
  const params = `(${components.join(" ")});created=${created};expires=${expires};keyid="${keyId}";alg="ed25519";nonce="bm9uY2U=";tag="${tag}"`;
  const base = [...lines, `"@signature-params": ${params}`].join("\n");
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", options.privateKey, new TextEncoder().encode(base)),
  );
  const headers = new Headers({
    "signature-input": `sig1=${params}`,
    signature: `sig1=:${base64(signature)}:`,
  });
  if (signatureAgentHeader !== null) {
    headers.set("signature-agent", signatureAgentHeader);
  }
  return new Request(url, { headers });
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
}

function resolverFor(keys: Record<string, CryptoKey>, expectedAgent: string | null = agentUrl) {
  return async (keyId: string, signatureAgent: string | null) =>
    signatureAgent === expectedAgent ? (keys[keyId] ?? null) : null;
}

const unverifiedResult = { verified: false, agent: null, keyId: null, nonce: null, created: null, expires: null };

function directoryResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/http-message-signatures-directory+json" },
    ...init,
  });
}

async function directoryFetchFor(publicKey: CryptoKey) {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return vi.fn(async (_input: string, _init: RequestInit) => directoryResponse({ keys: [jwk] }));
}

async function thumbprintOf(publicKey: CryptoKey): Promise<string> {
  const keys = await fetchKeyDirectory("https://keys.example", { fetch: await directoryFetchFor(publicKey) });
  const [keyId] = [...keys.keys()];
  if (keyId === undefined) {
    throw new Error("no key");
  }
  return keyId;
}

describe("verifyAgentRequest", () => {
  it("valid signature verifies and names the agent", async () => {
    const pair = await generateKeyPair();
    const keyId = await thumbprintOf(pair.publicKey);
    const request = await signedRequest({ privateKey: pair.privateKey, keyId });
    const fetchImpl = await directoryFetchFor(pair.publicKey);
    const resolveKey = createAgentKeyResolver({ origins: [agentUrl], fetch: fetchImpl, clock: clockAtCreation });

    const result = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });

    expect(result).toEqual({
      verified: true,
      agent: agentUrl,
      keyId,
      nonce: "bm9uY2U=",
      created: createdSeconds,
      expires: createdSeconds + 300,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${agentUrl}/.well-known/http-message-signatures-directory`);
  });

  it("wrong key fails", async () => {
    const signer = await generateKeyPair();
    const other = await generateKeyPair();
    const request = await signedRequest({ privateKey: signer.privateKey });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": other.publicKey }),
      clock: clockAtCreation,
    });

    expect(result).toEqual(unverifiedResult);
  });

  it("unknown key id fails", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, keyId: "unknown" });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("expired signature fails", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, expires: createdSeconds + 60 });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: () => (createdSeconds + 60 + 31) * 1000 + 0.5,
      maxSkewSeconds: 30,
    });

    expect(result.verified).toBe(false);
  });

  it("accepts a signature that expired within the allowed skew", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, expires: createdSeconds + 60 });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: () => (createdSeconds + 60 + 29) * 1000 + 0.5,
      maxSkewSeconds: 30,
    });

    expect(result.verified).toBe(true);
  });

  it("signature created in the future beyond the skew fails", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: () => (createdSeconds - 120) * 1000 + 0.5,
      maxSkewSeconds: 60,
    });

    expect(result.verified).toBe(false);
  });

  it("missing headers return verified false", async () => {
    const pair = await generateKeyPair();
    const resolveKey = vi.fn(resolverFor({ "test-key": pair.publicKey }));
    const signed = await signedRequest({ privateKey: pair.privateKey });

    const bare = new Request("https://shop.example/checkout");
    const withoutSignature = new Request(signed.url, {
      headers: { "signature-input": signed.headers.get("signature-input") ?? "" },
    });
    const withoutInput = new Request(signed.url, {
      headers: { signature: signed.headers.get("signature") ?? "" },
    });

    for (const request of [bare, withoutSignature, withoutInput]) {
      const result = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });
      expect(result).toEqual(unverifiedResult);
    }
    expect(resolveKey).not.toHaveBeenCalled();
  });

  it("malformed headers return verified false", async () => {
    const pair = await generateKeyPair();
    const request = new Request("https://shop.example/", {
      headers: { "signature-input": "sig1=(\"@authority\";created=", signature: "sig1=:%%%:" },
    });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("tampered covered component fails", async () => {
    const pair = await generateKeyPair();
    const signed = await signedRequest({ privateKey: pair.privateKey });
    const resolveKey = resolverFor({ "test-key": pair.publicKey });

    const otherHost = new Request("https://other.example/checkout?step=2", { headers: signed.headers });
    const otherAgentHeaders = new Headers(signed.headers);
    otherAgentHeaders.set("signature-agent", 'sig1="https://evil.example"');
    const otherAgent = new Request(signed.url, { headers: otherAgentHeaders });

    for (const request of [otherHost, otherAgent]) {
      const result = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });
      expect(result.verified).toBe(false);
    }
  });

  it("covers request header fields and derived path components", async () => {
    const pair = await generateKeyPair();
    const signed = await signedRequest({
      privateKey: pair.privateKey,
      signatureAgentHeader: null,
      components: ['"@method"', '"@target-uri"', '"@path"', '"@query"', '"content-type"'],
      componentLines: (url) => [
        '"@method": GET',
        `"@target-uri": ${url.href}`,
        `"@path": ${url.pathname}`,
        `"@query": ${url.search}`,
        '"content-type": application/json',
      ],
    });
    const headers = new Headers(signed.headers);
    headers.set("content-type", "application/json");
    const resolveKey = resolverFor({ "test-key": pair.publicKey }, null);

    const valid = await verifyAgentRequest(new Request(signed.url, { headers }), { resolveKey, clock: clockAtCreation });
    headers.set("content-type", "text/plain");
    const tampered = await verifyAgentRequest(new Request(signed.url, { headers }), { resolveKey, clock: clockAtCreation });

    expect(valid).toMatchObject({ verified: true, agent: null, keyId: "test-key" });
    expect(tampered.verified).toBe(false);
  });

  it("rejects a signature without the web-bot-auth tag", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, tag: "something-else" });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("rejects a Signature-Agent header that the signature does not cover", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({
      privateKey: pair.privateKey,
      components: ['"@authority"'],
      componentLines: (url) => [`"@authority": ${url.host}`],
    });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("rejects a signature that covers neither authority nor target uri", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({
      privateKey: pair.privateKey,
      signatureAgentHeader: null,
      components: ['"@method"'],
      componentLines: () => ['"@method": GET'],
    });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("rejects covered header names that are not valid field names", async () => {
    const pair = await generateKeyPair();
    for (const name of ["foo bar", ""]) {
      const request = await signedRequest({
        privateKey: pair.privateKey,
        signatureAgentHeader: null,
        components: ['"@authority"', `"${name}"`],
        componentLines: (url) => [`"@authority": ${url.host}`, `"${name}": value`],
      });

      const result = await verifyAgentRequest(request, {
        resolveKey: resolverFor({ "test-key": pair.publicKey }, null),
        clock: clockAtCreation,
      });

      expect(result).toEqual(unverifiedResult);
    }
  });

  it("rejects a long-lived signature", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, expires: createdSeconds + 3600 });

    const defaults = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });
    const allowed = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
      maxValiditySeconds: 3600,
    });

    expect(defaults.verified).toBe(false);
    expect(allowed.verified).toBe(true);
  });

  it("rejects a signature created too long ago even if it has not expired", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey, expires: createdSeconds + 300 });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: () => (createdSeconds + 300 + 1) * 1000 + 0.5,
      maxSkewSeconds: 0,
      maxValiditySeconds: 200,
    });

    expect(result.verified).toBe(false);
  });

  it("rejects a repeated nonce through seenNonce", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey });
    const seen = new Set<string>();
    const seenNonce = vi.fn(async (keyId: string, nonce: string, _expiresAt: number) => {
      const entry = `${keyId} ${nonce}`;
      const repeated = seen.has(entry);
      seen.add(entry);
      return repeated;
    });
    const options = { resolveKey: resolverFor({ "test-key": pair.publicKey }), clock: clockAtCreation, seenNonce };

    const first = await verifyAgentRequest(request, options);
    const replay = await verifyAgentRequest(request.clone(), options);

    expect(first.verified).toBe(true);
    expect(replay.verified).toBe(false);
    expect(seenNonce).toHaveBeenCalledWith("test-key", "bm9uY2U=", createdSeconds + 300);
  });

  it("does not consume a nonce for a signature that fails verification", async () => {
    const signer = await generateKeyPair();
    const other = await generateKeyPair();
    const request = await signedRequest({ privateKey: signer.privateKey });
    const seenNonce = vi.fn(async () => false);

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": other.publicKey }),
      clock: clockAtCreation,
      seenNonce,
    });

    expect(result.verified).toBe(false);
    expect(seenNonce).not.toHaveBeenCalled();
  });

  it("rejects a signature without a nonce when seenNonce is provided", async () => {
    const pair = await generateKeyPair();
    const url = new URL("https://shop.example/");
    const params = `("@authority");created=${createdSeconds};expires=${createdSeconds + 60};keyid="test-key";tag="web-bot-auth"`;
    const base = `"@authority": ${url.host}\n"@signature-params": ${params}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(base)),
    );
    const request = new Request(url, {
      headers: { "signature-input": `sig1=${params}`, signature: `sig1=:${base64(signature)}:` },
    });
    const resolveKey = resolverFor({ "test-key": pair.publicKey }, null);

    const withoutReplayCheck = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });
    const withReplayCheck = await verifyAgentRequest(request, {
      resolveKey,
      clock: clockAtCreation,
      seenNonce: async () => false,
    });

    expect(withoutReplayCheck).toMatchObject({ verified: true, nonce: null });
    expect(withReplayCheck.verified).toBe(false);
  });

  it("verifies a good label even when another web-bot-auth label is bad", async () => {
    const pair = await generateKeyPair();
    const good = await signedRequest({ privateKey: pair.privateKey });
    const goodInput = (good.headers.get("signature-input") ?? "").replace(/^sig1=/, "sig2=");
    const goodSignature = (good.headers.get("signature") ?? "").replace(/^sig1=/, "sig2=");
    const badSignature = `sig1=:${base64(new Uint8Array(64))}:`;
    const headers = new Headers(good.headers);
    headers.set("signature-input", `${good.headers.get("signature-input")}, ${goodInput}`);
    headers.set("signature", `${badSignature}, ${goodSignature}`);

    const result = await verifyAgentRequest(new Request(good.url, { headers }), {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(true);
  });

  it("only tries the first four web-bot-auth labels", async () => {
    const pair = await generateKeyPair();
    const good = await signedRequest({ privateKey: pair.privateKey });
    const params = (good.headers.get("signature-input") ?? "").replace(/^sig1=/, "");
    const goodSignature = (good.headers.get("signature") ?? "").replace(/^sig1=/, "");
    const badSignature = `:${base64(new Uint8Array(64))}:`;
    const labels = ["a", "b", "c", "d", "e"];
    const headers = new Headers(good.headers);
    headers.set("signature-input", labels.map((label) => `${label}=${params}`).join(", "));
    headers.set(
      "signature",
      labels.map((label) => `${label}=${label === "e" ? goodSignature : badSignature}`).join(", "),
    );
    const resolveKey = vi.fn(resolverFor({ "test-key": pair.publicKey }));

    const result = await verifyAgentRequest(new Request(good.url, { headers }), { resolveKey, clock: clockAtCreation });

    expect(result.verified).toBe(false);
    expect(resolveKey).toHaveBeenCalledTimes(4);
  });

  it("rejects duplicate component identifiers", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({
      privateKey: pair.privateKey,
      signatureAgentHeader: null,
      components: ['"@authority"', '"@authority"'],
      componentLines: (url) => [`"@authority": ${url.host}`, `"@authority": ${url.host}`],
    });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }, null),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("rejects unsupported component parameters", async () => {
    const pair = await generateKeyPair();
    for (const component of ['"content-type";sf', '"content-type";bs', '"@authority";req', '"@method";key="a"']) {
      const signed = await signedRequest({
        privateKey: pair.privateKey,
        signatureAgentHeader: null,
        components: ['"@authority"', component],
        componentLines: (url) => [`"@authority": ${url.host}`, `${component}: text/plain`],
      });
      const headers = new Headers(signed.headers);
      headers.set("content-type", "text/plain");

      const result = await verifyAgentRequest(new Request(signed.url, { headers }), {
        resolveKey: resolverFor({ "test-key": pair.publicKey }, null),
        clock: clockAtCreation,
      });

      expect(result.verified).toBe(false);
    }
  });

  it("rejects a signature covering more than one signature-agent member", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({
      privateKey: pair.privateKey,
      signatureAgentHeader: `sig1="${agentUrl}", sig2="https://other.example"`,
      components: ['"@authority"', '"signature-agent";key="sig1"', '"signature-agent";key="sig2"'],
      componentLines: (url) => [
        `"@authority": ${url.host}`,
        `"signature-agent";key="sig1": "${agentUrl}"`,
        `"signature-agent";key="sig2": "https://other.example"`,
      ],
    });

    const result = await verifyAgentRequest(request, {
      resolveKey: resolverFor({ "test-key": pair.publicKey }),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(false);
  });

  it("treats a resolved key that is not an Ed25519 verify key as unverified", async () => {
    const pair = await generateKeyPair();
    const request = await signedRequest({ privateKey: pair.privateKey });
    const hmacKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

    for (const key of [hmacKey, pair.privateKey]) {
      const result = await verifyAgentRequest(request, {
        resolveKey: async () => key,
        clock: clockAtCreation,
      });
      expect(result.verified).toBe(false);
    }
  });

  describe("draft-meunier-web-bot-auth-architecture-05 Ed25519 test vectors", () => {
    const testKeyId = "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";
    const testKey = () =>
      crypto.subtle.importKey(
        "jwk",
        { kty: "OKP", crv: "Ed25519", x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs" },
        { name: "Ed25519" },
        false,
        ["verify"],
      );
    const resolverExpecting = (expectedAgent: string | null) => async (keyId: string, signatureAgent: string | null) =>
      keyId === testKeyId && signatureAgent === expectedAgent ? testKey() : null;
    const clock = () => 1735689700 * 1000 + 0.5;
    const tenYearValiditySeconds = 4889289600 - 1735689600;

    it("A.2.1 signature without Signature-Agent verifies", async () => {
      const request = new Request("https://example.com/", {
        headers: {
          "signature-input": `sig1=("@authority");created=1735689600;keyid="${testKeyId}";alg="ed25519";expires=4889289600;nonce="g0iqFa9e1ffijlyOScDkXpfSmTbYpRNSGPJrQ1It20ahwgzB3jOUcdgLgFxUg7RMtW4V8IILaKKtA+YuSyIgJQ==";tag="web-bot-auth"`,
          signature: "sig1=:FFASViSdcgsyaqqYiCnkHreeZzbNKcTzDvZC5uVlP/dn9IbWj8j0o4wKFTH3rBnUiSUBduwm1Gp5VlIPCp01Ag==:",
        },
      });

      const result = await verifyAgentRequest(request, {
        resolveKey: resolverExpecting(null),
        clock,
        maxValiditySeconds: tenYearValiditySeconds,
      });

      expect(result).toMatchObject({ verified: true, agent: null, keyId: testKeyId });
    });

    it("A.2.3 legacy string Signature-Agent verifies and names the agent", async () => {
      const request = new Request("https://example.com/", {
        headers: {
          "signature-agent": '"https://signature-agent.test"',
          "signature-input": `sig2=("@authority" "signature-agent");created=1735689600;keyid="${testKeyId}";alg="ed25519";expires=1735693200;nonce="e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==";tag="web-bot-auth"`,
          signature: "sig2=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:",
        },
      });

      const result = await verifyAgentRequest(request, {
        resolveKey: resolverExpecting("https://signature-agent.test"),
        clock,
        maxValiditySeconds: 3600,
      });

      expect(result).toMatchObject({ verified: true, agent: "https://signature-agent.test", keyId: testKeyId });
    });
  });
});

describe("createAgentKeyResolver", () => {
  const directoryA = "https://agent-a.example";
  const directoryB = "https://agent-b.example";

  async function twoDirectories() {
    const pairA = await generateKeyPair();
    const pairB = await generateKeyPair();
    const jwkA = await crypto.subtle.exportKey("jwk", pairA.publicKey);
    const jwkB = await crypto.subtle.exportKey("jwk", pairB.publicKey);
    const fetchImpl = vi.fn(async (input: string, _init: RequestInit) =>
      directoryResponse({ keys: [input.startsWith(directoryA) ? jwkA : jwkB] }),
    );
    return {
      pairA,
      pairB,
      keyIdA: await thumbprintOf(pairA.publicKey),
      keyIdB: await thumbprintOf(pairB.publicKey),
      fetchImpl,
    };
  }

  it("a key from directory A signing Signature-Agent B fails", async () => {
    const { pairA, keyIdA, fetchImpl } = await twoDirectories();
    const resolveKey = createAgentKeyResolver({ origins: [directoryA, directoryB], fetch: fetchImpl, clock: clockAtCreation });
    const forged = await signedRequest({
      privateKey: pairA.privateKey,
      keyId: keyIdA,
      signatureAgentHeader: `sig1="${directoryB}"`,
      componentLines: (url) => [`"@authority": ${url.host}`, `"signature-agent";key="sig1": "${directoryB}"`],
    });
    const honest = await signedRequest({
      privateKey: pairA.privateKey,
      keyId: keyIdA,
      signatureAgentHeader: `sig1="${directoryA}"`,
      componentLines: (url) => [`"@authority": ${url.host}`, `"signature-agent";key="sig1": "${directoryA}"`],
    });

    const forgedResult = await verifyAgentRequest(forged, { resolveKey, clock: clockAtCreation });
    const honestResult = await verifyAgentRequest(honest, { resolveKey, clock: clockAtCreation });

    expect(forgedResult.verified).toBe(false);
    expect(honestResult).toMatchObject({ verified: true, agent: directoryA, keyId: keyIdA });
  });

  it("never fetches a directory for an agent outside the configured origins", async () => {
    const { keyIdA, fetchImpl } = await twoDirectories();
    const resolveKey = createAgentKeyResolver({ origins: [directoryA], fetch: fetchImpl, clock: clockAtCreation });

    expect(await resolveKey(keyIdA, "https://evil.example")).toBeNull();
    expect(await resolveKey(keyIdA, "http://agent-a.example")).toBeNull();
    expect(await resolveKey(keyIdA, "not a url")).toBeNull();
    expect(await resolveKey(keyIdA, null)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches each directory until the cache ttl passes", async () => {
    const { keyIdA, fetchImpl } = await twoDirectories();
    let now = 1000.5;
    const resolveKey = createAgentKeyResolver({
      origins: [directoryA],
      fetch: fetchImpl,
      clock: () => now,
      cacheTtlMs: 60000,
    });

    expect(await resolveKey(keyIdA, `${directoryA}/`)).not.toBeNull();
    now += 59999;
    expect(await resolveKey(keyIdA, directoryA)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await resolveKey(keyIdA, directoryA)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("remembers a failed directory fetch for 60 seconds by default, then retries", async () => {
    const { pairA } = await twoDirectories();
    const jwkA = await crypto.subtle.exportKey("jwk", pairA.publicKey);
    const keyIdA = await thumbprintOf(pairA.publicKey);
    const fetchImpl = vi
      .fn(async (_input: string, _init: RequestInit) => directoryResponse({ keys: [jwkA] }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }));
    let now = 1000.5;
    const resolveKey = createAgentKeyResolver({ origins: [directoryA], fetch: fetchImpl, clock: () => now });

    await expect(resolveKey(keyIdA, directoryA)).rejects.toThrow();
    now += 59999;
    await expect(resolveKey(keyIdA, directoryA)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await resolveKey(keyIdA, directoryA)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the configured failure cache time", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) => new Response("down", { status: 503 }));
    let now = 1000.5;
    const resolveKey = createAgentKeyResolver({
      origins: [directoryA],
      fetch: fetchImpl,
      clock: () => now,
      failureCacheTtlMs: 5000,
    });

    await expect(resolveKey("key", directoryA)).rejects.toThrow();
    now += 4999;
    await expect(resolveKey("key", directoryA)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 1;
    await expect(resolveKey("key", directoryA)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("verifyAgentRequest returns unverified when the directory fetch fails", async () => {
    const { pairA, keyIdA } = await twoDirectories();
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) => new Response("down", { status: 503 }));
    const resolveKey = createAgentKeyResolver({ origins: [directoryA], fetch: fetchImpl, clock: clockAtCreation });
    const request = await signedRequest({
      privateKey: pairA.privateKey,
      keyId: keyIdA,
      signatureAgentHeader: `sig1="${directoryA}"`,
      componentLines: (url) => [`"@authority": ${url.host}`, `"signature-agent";key="sig1": "${directoryA}"`],
    });

    const result = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });

    expect(result.verified).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("verifyAgentRequest returns unverified when a custom resolver throws", async () => {
    const { pairA, keyIdA } = await twoDirectories();
    const resolveKey = vi.fn(async () => {
      throw new Error("directory unavailable");
    });
    const request = await signedRequest({
      privateKey: pairA.privateKey,
      keyId: keyIdA,
      signatureAgentHeader: `sig1="${directoryA}"`,
      componentLines: (url) => [`"@authority": ${url.host}`, `"signature-agent";key="sig1": "${directoryA}"`],
    });

    const result = await verifyAgentRequest(request, { resolveKey, clock: clockAtCreation });

    expect(result).toMatchObject({ verified: false, agent: null });
    expect(resolveKey).toHaveBeenCalledTimes(1);
  });

  it("rejects configured origins that are not plain https origins", () => {
    for (const origin of ["http://agent-a.example", "https://agent-a.example/keys", "https://u:p@agent-a.example"]) {
      expect(() => createAgentKeyResolver({ origins: [origin] })).toThrow();
    }
  });
});

describe("fetchKeyDirectory", () => {
  const rfc8037Jwk = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
  const rfc8037Thumbprint = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the well-known directory and keys it by JWK thumbprint", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      directoryResponse({ keys: [rfc8037Jwk] }),
    );

    const keys = await fetchKeyDirectory("https://chatgpt.com", { fetch: fetchImpl });

    expect([...keys.keys()]).toEqual([rfc8037Thumbprint]);
    expect(keys.get(rfc8037Thumbprint)?.algorithm.name).toBe("Ed25519");
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://chatgpt.com/.well-known/http-message-signatures-directory");
    expect(init?.redirect).toBe("error");
  });

  it("returns keys that verify signatures from the matching private key", async () => {
    const pair = await generateKeyPair();
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const directory = await fetchKeyDirectory("https://chatgpt.com/", {
      fetch: async () => directoryResponse({ keys: [publicJwk] }),
    });
    const [keyId] = [...directory.keys()];
    const request = await signedRequest({ privateKey: pair.privateKey, keyId });

    const result = await verifyAgentRequest(request, {
      resolveKey: async (id, signatureAgent) => (signatureAgent === agentUrl ? (directory.get(id) ?? null) : null),
      clock: clockAtCreation,
    });

    expect(result.verified).toBe(true);
  });

  it("skips keys that are not Ed25519 public keys", async () => {
    const keys = await fetchKeyDirectory("https://chatgpt.com", {
      fetch: async () =>
        directoryResponse({
          keys: [
            { kty: "RSA", n: "abc", e: "AQAB" },
            { kty: "OKP", crv: "X25519", x: rfc8037Jwk.x },
            { kty: "OKP", crv: "Ed25519", x: "c2hvcnQ" },
            rfc8037Jwk,
          ],
        }),
    });

    expect([...keys.keys()]).toEqual([rfc8037Thumbprint]);
  });

  it("refuses origins that are not plain https origins", async () => {
    const fetchImpl = vi.fn(async () => directoryResponse({ keys: [rfc8037Jwk] }));

    for (const origin of [
      "http://chatgpt.com",
      "https://user:pass@chatgpt.com",
      "https://chatgpt.com/other/path",
      "https://chatgpt.com/?redirect=x",
      "file:///etc/passwd",
      "not a url",
    ]) {
      await expect(fetchKeyDirectory(origin, { fetch: fetchImpl })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a failed response", async () => {
    await expect(
      fetchKeyDirectory("https://chatgpt.com", { fetch: async () => new Response("nope", { status: 404 }) }),
    ).rejects.toThrow();
  });

  it("rejects a response larger than the size limit", async () => {
    const padding = "a".repeat(2000);
    await expect(
      fetchKeyDirectory("https://chatgpt.com", {
        fetch: async () => directoryResponse({ keys: [rfc8037Jwk], padding }),
        maxBytes: 1000,
      }),
    ).rejects.toThrow();
  });

  it("times out a directory that never answers", async () => {
    vi.useFakeTimers();
    const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });

    const pending = fetchKeyDirectory("https://chatgpt.com", { fetch: hangingFetch, timeoutMs: 250 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(250);

    await assertion;
  });
});
