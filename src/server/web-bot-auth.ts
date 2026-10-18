import type { Clock } from "../core/clock";

export type ResolveAgentKey = (keyId: string, signatureAgent: string | null) => Promise<CryptoKey | null>;

export interface VerifyAgentRequestOptions {
  resolveKey: ResolveAgentKey;
  clock?: Clock;
  maxSkewSeconds?: number;
  maxValiditySeconds?: number;
  seenNonce?: (keyId: string, nonce: string, expiresAt: number) => Promise<boolean>;
}

export interface AgentVerification {
  verified: boolean;
  agent: string | null;
  keyId: string | null;
  nonce: string | null;
  created: number | null;
  expires: number | null;
}

export interface FetchKeyDirectoryOptions {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface AgentKeyResolverOptions extends FetchKeyDirectoryOptions {
  origins: string[];
  cacheTtlMs?: number;
  failureCacheTtlMs?: number;
  clock?: Clock;
}

type Bytes = Uint8Array<ArrayBuffer>;
type BareItem = string | number | boolean | Bytes | SfToken;
type Parameters = Map<string, BareItem>;
interface Item {
  value: BareItem;
  params: Parameters;
}
interface InnerList {
  items: Item[];
  params: Parameters;
}
type Member = Item | InnerList;

class SfToken {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

class StructuredFieldError extends Error {}

const webBotAuthTag = "web-bot-auth";
const directoryPath = "/.well-known/http-message-signatures-directory";
const directoryMediaType = "application/http-message-signatures-directory+json";
const ed25519SignatureLength = 64;
const ed25519PublicKeyLength = 32;
const defaultMaxSkewSeconds = 60;
const defaultMaxValiditySeconds = 300;
const maxCandidateSignatures = 4;
const defaultDirectoryCacheTtlMs = 3600000;
const defaultDirectoryFailureCacheTtlMs = 60000;
const fieldNamePattern = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;
const defaultDirectoryTimeoutMs = 5000;
const defaultDirectoryMaxBytes = 65536;
const epochClock: Clock = () => Date.now();
const unverified: AgentVerification = {
  verified: false,
  agent: null,
  keyId: null,
  nonce: null,
  created: null,
  expires: null,
};

class StructuredFieldParser {
  private position = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  static dictionary(input: string): Map<string, Member> {
    const parser = new StructuredFieldParser(input);
    parser.skipSpaces();
    const result = parser.parseDictionary();
    parser.skipSpaces();
    parser.expectEnd();
    return result;
  }

  static item(input: string): Item {
    const parser = new StructuredFieldParser(input);
    parser.skipSpaces();
    const result = parser.parseItem();
    parser.skipSpaces();
    parser.expectEnd();
    return result;
  }

  private parseDictionary(): Map<string, Member> {
    const members = new Map<string, Member>();
    while (!this.atEnd()) {
      const key = this.parseKey();
      if (this.peek() === "=") {
        this.position += 1;
        members.set(key, this.parseMember());
      } else {
        members.set(key, { value: true, params: this.parseParameters() });
      }
      this.skipOptionalWhitespace();
      if (this.atEnd()) {
        return members;
      }
      this.expect(",");
      this.skipOptionalWhitespace();
      if (this.atEnd()) {
        throw new StructuredFieldError("trailing comma");
      }
    }
    return members;
  }

  private parseMember(): Member {
    return this.peek() === "(" ? this.parseInnerList() : this.parseItem();
  }

  private parseInnerList(): InnerList {
    this.expect("(");
    const items: Item[] = [];
    while (!this.atEnd()) {
      this.skipSpaces();
      if (this.peek() === ")") {
        this.position += 1;
        return { items, params: this.parseParameters() };
      }
      items.push(this.parseItem());
      const next = this.peek();
      if (next !== " " && next !== ")") {
        throw new StructuredFieldError("malformed inner list");
      }
    }
    throw new StructuredFieldError("unterminated inner list");
  }

  private parseItem(): Item {
    const value = this.parseBareItem();
    return { value, params: this.parseParameters() };
  }

  private parseParameters(): Parameters {
    const params: Parameters = new Map();
    while (this.peek() === ";") {
      this.position += 1;
      this.skipSpaces();
      const key = this.parseKey();
      let value: BareItem = true;
      if (this.peek() === "=") {
        this.position += 1;
        value = this.parseBareItem();
      }
      params.set(key, value);
    }
    return params;
  }

  private parseKey(): string {
    const match = /^[a-z*][a-z0-9_\-.*]*/.exec(this.input.slice(this.position));
    if (!match) {
      throw new StructuredFieldError("invalid key");
    }
    this.position += match[0].length;
    return match[0];
  }

  private parseBareItem(): BareItem {
    const next = this.peek();
    if (next === '"') {
      return this.parseString();
    }
    if (next === ":") {
      return this.parseByteSequence();
    }
    if (next === "?") {
      return this.parseBoolean();
    }
    if (next !== undefined && /[-0-9]/.test(next)) {
      return this.parseInteger();
    }
    if (next !== undefined && /[A-Za-z*]/.test(next)) {
      return this.parseToken();
    }
    throw new StructuredFieldError("invalid bare item");
  }

  private parseString(): string {
    this.expect('"');
    let output = "";
    while (!this.atEnd()) {
      const char = this.input[this.position] ?? "";
      this.position += 1;
      if (char === "\\") {
        const escaped = this.input[this.position];
        if (escaped !== '"' && escaped !== "\\") {
          throw new StructuredFieldError("invalid escape");
        }
        output += escaped;
        this.position += 1;
      } else if (char === '"') {
        return output;
      } else {
        const code = char.charCodeAt(0);
        if (code < 0x20 || code > 0x7e) {
          throw new StructuredFieldError("invalid string character");
        }
        output += char;
      }
    }
    throw new StructuredFieldError("unterminated string");
  }

  private parseByteSequence(): Bytes {
    this.expect(":");
    const end = this.input.indexOf(":", this.position);
    if (end === -1) {
      throw new StructuredFieldError("unterminated byte sequence");
    }
    const encoded = this.input.slice(this.position, end);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new StructuredFieldError("invalid byte sequence");
    }
    this.position = end + 1;
    return decodeBase64(encoded);
  }

  private parseBoolean(): boolean {
    this.expect("?");
    const value = this.peek();
    if (value !== "0" && value !== "1") {
      throw new StructuredFieldError("invalid boolean");
    }
    this.position += 1;
    return value === "1";
  }

  private parseInteger(): number {
    const match = /^-?[0-9]{1,15}/.exec(this.input.slice(this.position));
    if (!match) {
      throw new StructuredFieldError("invalid integer");
    }
    this.position += match[0].length;
    if (this.peek() === ".") {
      throw new StructuredFieldError("decimals are not supported");
    }
    return Number(match[0]);
  }

  private parseToken(): SfToken {
    const match = /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/.exec(this.input.slice(this.position));
    if (!match) {
      throw new StructuredFieldError("invalid token");
    }
    this.position += match[0].length;
    return new SfToken(match[0]);
  }

  private peek(): string | undefined {
    return this.input[this.position];
  }

  private atEnd(): boolean {
    return this.position >= this.input.length;
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      throw new StructuredFieldError(`expected ${char}`);
    }
    this.position += 1;
  }

  private expectEnd(): void {
    if (!this.atEnd()) {
      throw new StructuredFieldError("unexpected trailing characters");
    }
  }

  private skipSpaces(): void {
    while (this.peek() === " ") {
      this.position += 1;
    }
  }

  private skipOptionalWhitespace(): void {
    while (this.peek() === " " || this.peek() === "\t") {
      this.position += 1;
    }
  }
}

function serializeBareItem(value: BareItem): string {
  if (typeof value === "string") {
    return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "?1" : "?0";
  }
  if (value instanceof SfToken) {
    return value.name;
  }
  return `:${encodeBase64(value)}:`;
}

function serializeParameters(params: Parameters): string {
  let output = "";
  for (const [key, value] of params) {
    output += value === true ? `;${key}` : `;${key}=${serializeBareItem(value)}`;
  }
  return output;
}

function serializeItem(item: Item): string {
  return serializeBareItem(item.value) + serializeParameters(item.params);
}

function serializeMember(member: Member): string {
  if (isInnerList(member)) {
    return `(${member.items.map(serializeItem).join(" ")})${serializeParameters(member.params)}`;
  }
  return serializeItem(member);
}

function isInnerList(member: Member): member is InnerList {
  return "items" in member;
}

function decodeBase64(encoded: string): Bytes {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new StructuredFieldError("invalid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
    return null;
  }
  const standard = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeBase64(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface CoveredComponent {
  identifier: string;
  value: string;
}

interface SignatureCandidate {
  input: InnerList;
  signature: Bytes;
}

function derivedComponentValue(name: string, request: Request, url: URL): string | null {
  switch (name) {
    case "@method":
      return request.method;
    case "@authority":
      return url.host;
    case "@scheme":
      return url.protocol.slice(0, -1);
    case "@target-uri":
      return url.href;
    case "@path":
      return url.pathname || "/";
    case "@query":
      return url.search || "?";
    case "@request-target":
      return `${url.pathname || "/"}${url.search}`;
    default:
      return null;
  }
}

function fieldComponentValue(name: string, params: Parameters, request: Request): string | null {
  const raw = request.headers.get(name);
  if (raw === null) {
    return null;
  }
  const fieldValue = raw.trim();
  const dictionaryKey = params.get("key");
  if (dictionaryKey === undefined) {
    return fieldValue;
  }
  if (typeof dictionaryKey !== "string") {
    return null;
  }
  const member = StructuredFieldParser.dictionary(fieldValue).get(dictionaryKey);
  return member === undefined ? null : serializeMember(member);
}

function coveredComponents(input: InnerList, request: Request): CoveredComponent[] | null {
  const url = new URL(request.url);
  const seen = new Set<string>();
  const components: CoveredComponent[] = [];
  for (const item of input.items) {
    if (typeof item.value !== "string") {
      return null;
    }
    const name = item.value;
    const identifier = serializeItem(item);
    if (seen.has(identifier)) {
      return null;
    }
    seen.add(identifier);
    const derived = name.startsWith("@");
    const onlyKeyParam = [...item.params.keys()].every((param) => param === "key");
    if ((derived && item.params.size > 0) || !onlyKeyParam || (!derived && !fieldNamePattern.test(name))) {
      return null;
    }
    const value = derived ? derivedComponentValue(name, request, url) : fieldComponentValue(name, item.params, request);
    if (value === null) {
      return null;
    }
    components.push({ identifier, value });
  }
  return components;
}

function signatureBase(components: CoveredComponent[], input: InnerList): string {
  const lines = components.map((component) => `${component.identifier}: ${component.value}`);
  lines.push(`"@signature-params": ${serializeMember(input)}`);
  return lines.join("\n");
}

function signatureAgentName(input: InnerList, request: Request): { covered: boolean; agent: string | null } {
  const header = request.headers.get("signature-agent");
  const coverages = input.items.filter((item) => item.value === "signature-agent");
  if (coverages.length > 1) {
    return { covered: false, agent: null };
  }
  if (header === null) {
    return { covered: true, agent: null };
  }
  const coverage = coverages[0];
  if (coverage === undefined) {
    return { covered: false, agent: null };
  }
  const dictionaryKey = coverage.params.get("key");
  if (typeof dictionaryKey === "string") {
    const member = StructuredFieldParser.dictionary(header.trim()).get(dictionaryKey);
    const agent = member !== undefined && !isInnerList(member) && typeof member.value === "string" ? member.value : null;
    return { covered: agent !== null, agent };
  }
  const item = StructuredFieldParser.item(header.trim());
  const agent = typeof item.value === "string" ? item.value : null;
  return { covered: agent !== null, agent };
}

function signatureCandidates(request: Request): SignatureCandidate[] {
  const inputHeader = request.headers.get("signature-input");
  const signatureHeader = request.headers.get("signature");
  if (inputHeader === null || signatureHeader === null) {
    return [];
  }
  const inputs = StructuredFieldParser.dictionary(inputHeader.trim());
  const signatures = StructuredFieldParser.dictionary(signatureHeader.trim());
  const candidates: SignatureCandidate[] = [];
  for (const [label, input] of inputs) {
    const signature = signatures.get(label);
    if (!isInnerList(input) || signature === undefined || isInnerList(signature)) {
      continue;
    }
    if (input.params.get("tag") !== webBotAuthTag || !(signature.value instanceof Uint8Array)) {
      continue;
    }
    candidates.push({ input, signature: signature.value });
    if (candidates.length === maxCandidateSignatures) {
      break;
    }
  }
  return candidates;
}

function validityWindow(
  params: Parameters,
  nowSeconds: number,
  options: VerifyAgentRequestOptions,
): { created: number; expires: number } | null {
  const maxSkewSeconds = options.maxSkewSeconds ?? defaultMaxSkewSeconds;
  const maxValiditySeconds = options.maxValiditySeconds ?? defaultMaxValiditySeconds;
  const created = params.get("created");
  const expires = params.get("expires");
  if (typeof created !== "number" || typeof expires !== "number" || expires <= created) {
    return null;
  }
  const tooLong = expires - created > maxValiditySeconds;
  const tooOld = created < nowSeconds - maxValiditySeconds - maxSkewSeconds;
  const notYetValid = created > nowSeconds + maxSkewSeconds;
  const expired = nowSeconds > expires + maxSkewSeconds;
  return tooLong || tooOld || notYetValid || expired ? null : { created, expires };
}

function coversTarget(input: InnerList): boolean {
  return input.items.some(
    (item) => (item.value === "@authority" || item.value === "@target-uri") && item.params.size === 0,
  );
}

function isEd25519VerifyKey(key: CryptoKey): boolean {
  return key.type === "public" && key.algorithm.name === "Ed25519" && key.usages.includes("verify");
}

async function resolveKeyOrNull(
  resolveKey: ResolveAgentKey,
  keyId: string,
  agent: string | null,
): Promise<CryptoKey | null> {
  try {
    return await resolveKey(keyId, agent);
  } catch {
    return null;
  }
}

async function verifyCandidate(
  candidate: SignatureCandidate,
  request: Request,
  options: VerifyAgentRequestOptions,
  nowSeconds: number,
): Promise<AgentVerification> {
  const { input, signature } = candidate;
  const keyId = input.params.get("keyid");
  const alg = input.params.get("alg");
  const nonce = input.params.get("nonce");
  if (typeof keyId !== "string" || (alg !== undefined && alg !== "ed25519")) {
    return unverified;
  }
  if (nonce !== undefined && typeof nonce !== "string") {
    return unverified;
  }
  if (options.seenNonce !== undefined && nonce === undefined) {
    return unverified;
  }
  if (signature.length !== ed25519SignatureLength || !coversTarget(input)) {
    return unverified;
  }
  const window = validityWindow(input.params, nowSeconds, options);
  if (window === null) {
    return unverified;
  }
  const { covered, agent } = signatureAgentName(input, request);
  if (!covered) {
    return unverified;
  }
  const components = coveredComponents(input, request);
  if (components === null) {
    return unverified;
  }
  const key = await resolveKeyOrNull(options.resolveKey, keyId, agent);
  if (key === null || !isEd25519VerifyKey(key)) {
    return unverified;
  }
  const base = new TextEncoder().encode(signatureBase(components, input));
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, signature, base))) {
    return unverified;
  }
  if (options.seenNonce !== undefined && nonce !== undefined && (await options.seenNonce(keyId, nonce, window.expires))) {
    return unverified;
  }
  return { verified: true, agent, keyId, nonce: nonce ?? null, created: window.created, expires: window.expires };
}

export async function verifyAgentRequest(
  req: Request,
  opts: VerifyAgentRequestOptions,
): Promise<AgentVerification> {
  const nowSeconds = (opts.clock ?? epochClock)() / 1000;
  let candidates: SignatureCandidate[];
  try {
    candidates = signatureCandidates(req);
  } catch (error) {
    if (error instanceof StructuredFieldError) {
      return unverified;
    }
    throw error;
  }
  for (const candidate of candidates) {
    try {
      const result = await verifyCandidate(candidate, req, opts, nowSeconds);
      if (result.verified) {
        return result;
      }
    } catch (error) {
      if (!(error instanceof StructuredFieldError)) {
        throw error;
      }
    }
  }
  return unverified;
}

function plainHttpsOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Key directory origin is not a valid URL");
  }
  const hasExtraParts =
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "";
  if (parsed.protocol !== "https:" || hasExtraParts || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("Key directory origin must be a plain https origin");
  }
  return parsed.origin;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Key directory response is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function ed25519Thumbprint(x: string): Promise<string> {
  const canonical = JSON.stringify({ crv: "Ed25519", kty: "OKP", x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return encodeBase64Url(new Uint8Array(digest));
}

async function importDirectoryKey(entry: unknown): Promise<[string, CryptoKey] | null> {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const { kty, crv, x } = entry as Record<string, unknown>;
  if (kty !== "OKP" || crv !== "Ed25519" || typeof x !== "string") {
    return null;
  }
  if (decodeBase64Url(x)?.length !== ed25519PublicKeyLength) {
    return null;
  }
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x }, { name: "Ed25519" }, false, ["verify"]);
  return [await ed25519Thumbprint(x), key];
}

export async function fetchKeyDirectory(
  origin: string,
  options: FetchKeyDirectoryOptions = {},
): Promise<Map<string, CryptoKey>> {
  const url = `${plainHttpsOrigin(origin)}${directoryPath}`;
  const fetchImpl = options.fetch ?? ((input: string, init: RequestInit) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Key directory request timed out")),
    options.timeoutMs ?? defaultDirectoryTimeoutMs,
  );
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: directoryMediaType },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Key directory request failed with status ${response.status}`);
    }
    const directory: unknown = JSON.parse(await readLimitedText(response, options.maxBytes ?? defaultDirectoryMaxBytes));
    const entries = (directory as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(entries)) {
      throw new Error("Key directory has no keys array");
    }
    const keys = new Map<string, CryptoKey>();
    for (const entry of entries) {
      const imported = await importDirectoryKey(entry);
      if (imported !== null) {
        keys.set(imported[0], imported[1]);
      }
    }
    return keys;
  } finally {
    clearTimeout(timeout);
  }
}

interface CachedDirectory {
  keys: Promise<Map<string, CryptoKey>>;
  expiresAt: number;
}

function originOf(signatureAgent: string): string | null {
  try {
    return new URL(signatureAgent).origin;
  } catch {
    return null;
  }
}

export function createAgentKeyResolver(options: AgentKeyResolverOptions): ResolveAgentKey {
  const origins = new Set(options.origins.map(plainHttpsOrigin));
  const clock = options.clock ?? epochClock;
  const cacheTtlMs = options.cacheTtlMs ?? defaultDirectoryCacheTtlMs;
  const failureCacheTtlMs = options.failureCacheTtlMs ?? defaultDirectoryFailureCacheTtlMs;
  const directoryOptions: FetchKeyDirectoryOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
  };
  const cache = new Map<string, CachedDirectory>();

  function directoryFor(origin: string): Promise<Map<string, CryptoKey>> {
    const now = clock();
    const cached = cache.get(origin);
    if (cached !== undefined && now < cached.expiresAt) {
      return cached.keys;
    }
    const keys = fetchKeyDirectory(origin, directoryOptions);
    const entry: CachedDirectory = { keys, expiresAt: now + cacheTtlMs };
    cache.set(origin, entry);
    keys.catch(() => {
      entry.expiresAt = clock() + failureCacheTtlMs;
    });
    return keys;
  }

  return async (keyId, signatureAgent) => {
    if (signatureAgent === null) {
      return null;
    }
    const origin = originOf(signatureAgent);
    if (origin === null || !origins.has(origin)) {
      return null;
    }
    const keys = await directoryFor(origin);
    return keys.get(keyId) ?? null;
  };
}
