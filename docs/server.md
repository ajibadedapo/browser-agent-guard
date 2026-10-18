# Server check

Everything here is exported from `browser-agent-guard/server`. It uses the standard `Request`, `Response` and Web Crypto APIs, so it works in Node 22.18 or later and in frameworks built on those APIs, such as Next.js route handlers on the Node runtime.

## Why a server check

The browser script can be removed or edited by anyone who controls the browser. In block mode, the decision that holds is the one your server makes. The server check:

- re-scores the evidence itself, so a verdict sent by the browser is never trusted;
- requires a one-time token signed by your server, so old or copied summaries are rejected;
- treats a missing summary as blocked in block mode, unless you choose otherwise.

It does not stop someone who controls their browser from forging evidence that looks human. It makes that harder and more costly.

## The flow

1. The page loads the guard with `tokenEndpoint` set.
2. On a protected form submit (a form that submits with POST to the page's own origin, matching the `forms` selector if set), the guard holds the submit, POSTs to your token endpoint, and waits up to `tokenTimeoutMs` (default 3000 ms).
3. It writes the evidence summary and token into a hidden field (`bag_summary` by default), then submits the form again. Your own submit handlers run once, on this second submit.
4. Your server reads the field and calls `verifySubmission`.

If the token request fails or times out, the summary is sent without a token, and the server sees it as `missing`.

If scoring throws while the submit is held, block mode fails closed: the submit is dropped. Detect mode submits anyway. Without a token endpoint the submit is not held, so an error in scoring shows in the console and the form submits without a summary; `verifySubmission` then returns `missing`, which block mode rejects unless you pass `missing: "allow"`.

## Secret

All token functions take a secret string of at least 32 bytes (`MINIMUM_SECRET_BYTES`). Shorter secrets throw. Generate one with `openssl rand -base64 32`, keep it in your server environment, and use the same secret on every server.

## Tokens

| Export | What it does |
| --- | --- |
| `handleTokenRequest(request, secret)` | Returns `{ "token": "..." }` with `cache-control: no-store` for a POST. Any other method gets 405. |
| `issueToken(secret, clock?, ttlMs?)` | Returns a new token string. `ttlMs` defaults to `DEFAULT_TOKEN_TTL_MS` (10 minutes) and must be greater than 0. |
| `readToken(token, secret)` | Returns `{ id, expiresAt }` if the signature is valid, otherwise `null`. It does not check expiry or reuse. |
| `memoryTokenStore(clock?)` | An in-process `TokenStore`. |

A token is a random 128-bit id, an expiry time in milliseconds since the epoch, and an HMAC SHA-256 signature over both. Expiry uses the server clock, so keep server clocks in sync.

Rate limit the token endpoint. Anyone can request tokens, and each one is valid until used or expired.

Example Next.js route, `app/api/agent-guard/token/route.ts`:

```ts
import { handleTokenRequest } from "browser-agent-guard/server";

export async function POST(request: Request) {
  return handleTokenRequest(request, process.env.AGENT_GUARD_SECRET!);
}
```

## verifySubmission

```ts
const result = await verifySubmission({
  summary,
  secret,
  store,
  mode: "block",
});
```

Input:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `summary` | `string \| null` | required | The `bag_summary` field value, or `null` if absent. |
| `secret` | string | required | The token secret. |
| `store` | `TokenStore` | required | Where used token ids are recorded. |
| `mode` | `"detect"` or `"block"` | required | In detect mode every request is allowed. In block mode an agent marker next to clearly human behaviour scores `unsure`, as in the browser. |
| `missing` | `"block"` or `"allow"` | `"block"` | Whether block mode lets through a request with no summary or no token. |
| `signals` | `Signal[]` | `defaultSignals` | The signals used to re-score. Use the same ones as the browser. |
| `verifiedAgent` | `string \| null` | `null` | The agent name from `verifyAgentRequest`. Never take this from anything the client sends. |
| `allow` | `string[]` | `[]` | Verified agent names to let through. |
| `clock` | `() => number` | `Date.now` | For tests. |

Result: `{ allowed, verdict, reason }`.

| `reason` | When | `allowed` in block mode | `allowed` in detect mode |
| --- | --- | --- | --- |
| `allowed-agent` | `verifiedAgent` is in `allow` | yes | yes |
| `missing` | No summary, or a summary with no token | no, or yes with `missing: "allow"` | yes |
| `bad-summary` | The summary could not be parsed | no | yes |
| `bad-token` | The token signature is wrong | no | yes |
| `expired` | The token has expired | no | yes |
| `replayed` | The token was already used | no | yes |
| `agent` | The server's own score says `agent` | no | yes |
| `ok` | Everything checked out | yes | yes |

The allow-list is checked first, then the summary, then the token, then the score. For `bad-token`, `expired`, `replayed`, `agent` and `ok`, `verdict` is the server's own score of the evidence, so you can log it in detect mode. For `missing` and `bad-summary` the verdict is `unsure` with confidence 0.

Summaries over 400,000 characters or with more than 300 events are rejected as `bad-summary`. Make sure your body size limit allows a summary of that size.

Log `reason` and `verdict.reasons` on your server. Never send them back to the client: they tell an attacker what to change. Return a plain error with status 403.

## Token store

```ts
interface TokenStore {
  consume(id: string, expiresAt: number): Promise<boolean>;
}
```

`consume` must return `true` the first time it sees an id and `false` every time after, until `expiresAt` (milliseconds since the epoch) has passed. It must do this as a single atomic step. A store that checks and then writes in two steps lets two parallel requests both use the same token.

`memoryTokenStore()` keeps used ids in memory and drops them after they expire. It only works within one process. If you run more than one server or process, use a shared store. With Redis, `SET key value NX PXAT expiresAt` is atomic. Using the node-redis client:

```ts
import type { TokenStore } from "browser-agent-guard/server";
import { createClient } from "redis";

const redis = await createClient({ url: process.env.REDIS_URL }).connect();

export const tokenStore: TokenStore = {
  async consume(id, expiresAt) {
    const stored = await redis.set(`agent-guard:token:${id}`, "1", { NX: true, PXAT: expiresAt });
    return stored === "OK";
  },
};
```

## Web Bot Auth

Some agent operators sign their agents' requests with Web Bot Auth: HTTP message signatures (RFC 9421) using an Ed25519 key that the operator publishes in a key directory. You can use this to let a named agent through block mode. Page markers never grant access, since anyone can fake them.

### verifyAgentRequest

```ts
const identity = await verifyAgentRequest(request, { resolveKey, seenNonce });
```

Returns `{ verified, agent, keyId, nonce, created, expires }`. When `verified` is `true`, `agent` is the value of the `Signature-Agent` header.

A request is verified only when one of its signatures (up to 4 are tried):

- has `tag="web-bot-auth"`, a `keyid`, and `alg` that is absent or `ed25519`;
- covers `@authority` or `@target-uri`;
- covers the `Signature-Agent` header when that header is present;
- has `created` and `expires`, lasts no longer than `maxValiditySeconds` (default 300), and is within `maxSkewSeconds` (default 60) of the current time;
- has a key returned by `resolveKey` that verifies the signature;
- has a nonce not seen before, when `seenNonce` is set. With `seenNonce` set, signatures without a nonce are rejected.

Malformed headers, and a `resolveKey` that throws (for example because a key directory is down), return an unverified result rather than throwing.

The signature covers the host, so `request.url` must have the public host the agent signed. If a proxy rewrites the host before your app sees it, verification fails.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `resolveKey` | required | `(keyId, signatureAgent) => Promise<CryptoKey \| null>`. Use `createAgentKeyResolver`. |
| `seenNonce` | none | `(keyId, nonce, expiresAt) => Promise<boolean>`. Return `true` if the nonce was already used. |
| `maxSkewSeconds` | 60 | Allowed clock difference. |
| `maxValiditySeconds` | 300 | Longest signature lifetime accepted. |
| `clock` | `Date.now` | For tests. |

### createAgentKeyResolver

```ts
const resolveKey = createAgentKeyResolver({ origins: ["https://agent.example"] });
```

The resolver takes the origin of the `Signature-Agent` header and, only if it is in `origins`, fetches that origin's key directory at `/.well-known/http-message-signatures-directory`. It looks up the key whose JWK thumbprint (RFC 7638) matches `keyid`. Requests with no `Signature-Agent` header get no key, so they are never verified.

| Option | Default | Meaning |
| --- | --- | --- |
| `origins` | required | Plain `https` origins you trust. Anything else throws. |
| `cacheTtlMs` | 1 hour | How long a fetched directory is reused. |
| `failureCacheTtlMs` | 60 seconds | How long a failed directory fetch is remembered. During that time the resolver rejects at once instead of fetching again, so a directory that is down is not fetched on every request. |
| `clock` | `Date.now` | For tests. |
| `timeoutMs` | 5000 | Directory request timeout. |
| `maxBytes` | 65536 | Largest directory response accepted. |
| `fetch` | global `fetch` | For tests. |

**Key rotation.** A fetched directory is reused for `cacheTtlMs` (1 hour by default). When an agent operator rotates its key, requests signed with the new key fail verification until the cached directory expires, for up to an hour. If you allow an agent whose operator rotates keys often, lower `cacheTtlMs`. A failed fetch is retried after `failureCacheTtlMs`.

`fetchKeyDirectory(origin, options?)` is exported for your own resolvers. It only accepts plain `https` origins and does not follow redirects. Never pass it a value taken from a request header: that would let any caller make your server fetch a URL of their choice. Pass only origins you have listed yourself.

### seenNonce

Without `seenNonce`, a captured signed request can be replayed until it expires. With it, each nonce is accepted once. It is called only after the signature verifies. `expiresAt` is the signature's `expires` time in seconds since the epoch.

Like the token store, it must check and record in one atomic step, shared across all your servers. Keep each nonce until `expiresAt` plus `maxSkewSeconds`, since signatures are accepted until then. In the same file as the token store above:

```ts
export async function seenNonce(keyId: string, nonce: string, expiresAt: number): Promise<boolean> {
  const stored = await redis.set(`agent-guard:nonce:${keyId}:${nonce}`, "1", {
    NX: true,
    PXAT: (expiresAt + 60) * 1000,
  });
  return stored !== "OK";
}
```

### Allowing the agent

Pass the verified name and your allow-list to `verifySubmission`:

```ts
const result = await verifySubmission({
  summary,
  secret,
  store: tokenStore,
  mode: "block",
  verifiedAgent: identity.verified ? identity.agent : null,
  allow: ["https://agent.example"],
});
```

`allow` entries are compared with the exact `Signature-Agent` value. An allowed agent gets `reason: "allowed-agent"` and is let through without checking the summary.
