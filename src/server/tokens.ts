import type { Clock } from "../core/clock";

export const DEFAULT_TOKEN_TTL_MS = 600_000;
export const MINIMUM_SECRET_BYTES = 32;

const TOKEN_ID_BYTES = 16;
const tokenPattern = /^([A-Za-z0-9_-]{22})\.([0-9]{1,16})\.([A-Za-z0-9_-]{43})$/;

export const wallClock: Clock = () => Date.now();

export interface TokenStore {
  consume(id: string, expiresAt: number): Promise<boolean>;
}

export interface MemoryTokenStore extends TokenStore {
  size(): number;
}

export type TokenClaims = { id: string; expiresAt: number };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

export function assertSecret(secret: string): void {
  if (new TextEncoder().encode(secret).byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error(`browser-agent-guard: the token secret must be at least ${MINIMUM_SECRET_BYTES} bytes long`);
  }
}

async function importSecret(secret: string): Promise<CryptoKey> {
  assertSecret(secret);
  const cached = importedKeys.get(secret);
  if (cached !== undefined) {
    return cached;
  }
  const imported = globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  importedKeys.set(secret, imported);
  imported.catch(() => importedKeys.delete(secret));
  return imported;
}

function assertTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("browser-agent-guard: the token ttlMs must be a finite number greater than 0");
  }
}

function signedPayload(id: string, expiresAt: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${id}.${expiresAt}`);
}

export async function issueToken(
  secret: string,
  clock: Clock = wallClock,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS,
): Promise<string> {
  assertTtl(ttlMs);
  const key = await importSecret(secret);
  const id = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(TOKEN_ID_BYTES)));
  const expiresAt = Math.floor(clock() + ttlMs);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, signedPayload(id, expiresAt));
  return `${id}.${expiresAt}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function readToken(token: string, secret: string): Promise<TokenClaims | null> {
  const key = await importSecret(secret);
  const match = tokenPattern.exec(token);
  if (match === null) {
    return null;
  }
  const [, id, expiry, signature] = match as unknown as [string, string, string, string];
  const expiresAt = Number(expiry);
  const valid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    signedPayload(id, expiresAt),
  );
  return valid ? { id, expiresAt } : null;
}

export function memoryTokenStore(clock: Clock = wallClock): MemoryTokenStore {
  const consumed = new Map<string, number>();

  function dropExpiredFromFront(now: number): void {
    for (const [id, expiresAt] of consumed) {
      if (expiresAt > now) {
        return;
      }
      consumed.delete(id);
    }
  }

  return {
    async consume(id, expiresAt) {
      const now = clock();
      dropExpiredFromFront(now);
      if (expiresAt <= now || consumed.has(id)) {
        return false;
      }
      consumed.set(id, expiresAt);
      return true;
    },
    size() {
      return consumed.size;
    },
  };
}

export async function handleTokenRequest(req: Request, secret: string): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  }
  const token = await issueToken(secret);
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
