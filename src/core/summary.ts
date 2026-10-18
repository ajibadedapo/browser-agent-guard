import type { ElementRect, Environment, EvidenceEvent, FieldKind, PointerKind } from "./types";

export const SUMMARY_EVENT_LIMIT = 300;
const SUMMARY_VERSION = 1;
const MAX_SUMMARY_LENGTH = 400_000;

export type ParsedSummary = { events: EvidenceEvent[]; env: Environment; token: string | null };

type UnknownRecord = Record<string, unknown>;

const pointerKinds: ReadonlySet<string> = new Set<PointerKind>(["mouse", "touch", "pen", "keyboard"]);
const fieldKinds: ReadonlySet<string> = new Set<FieldKind>(["credential", "text", "select", "checkbox", "other"]);

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function buildSummary(events: EvidenceEvent[], env: Environment, token: string | null): string {
  const payload = {
    v: SUMMARY_VERSION,
    events: events.slice(-SUMMARY_EVENT_LIMIT),
    env: { webdriver: env.webdriver, automationTraces: env.automationTraces },
    token,
  };
  return encodeBase64Url(JSON.stringify(payload));
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRect(value: unknown): value is ElementRect {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.w) && isFiniteNumber(value.h);
}

function isPointer(value: unknown): boolean {
  return typeof value === "string" && pointerKinds.has(value);
}

function isField(value: unknown): boolean {
  return typeof value === "string" && fieldKinds.has(value);
}

function isEvent(value: unknown): value is EvidenceEvent {
  if (!isRecord(value) || !isFiniteNumber(value.t)) {
    return false;
  }
  switch (value.kind) {
    case "move":
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isPointer(value.pointer);
    case "down":
    case "click":
      return (
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isPointer(value.pointer) &&
        typeof value.trusted === "boolean" &&
        isRect(value.rect)
      );
    case "key":
      return (
        typeof value.trusted === "boolean" &&
        typeof value.printable === "boolean" &&
        (value.modifier === null || value.modifier === "meta" || value.modifier === "ctrl")
      );
    case "input":
      return (
        typeof value.trusted === "boolean" &&
        (value.inputType === null || typeof value.inputType === "string") &&
        (value.length === null || isFiniteNumber(value.length)) &&
        isField(value.field)
      );
    case "paste":
    case "change":
      return typeof value.trusted === "boolean" && isField(value.field);
    case "scroll":
      return typeof value.trusted === "boolean";
    case "marker":
      return typeof value.agent === "string" && typeof value.marker === "string";
    default:
      return false;
  }
}

function isEnvironment(value: unknown): value is Environment {
  return (
    isRecord(value) &&
    typeof value.webdriver === "boolean" &&
    Array.isArray(value.automationTraces) &&
    value.automationTraces.every((trace) => typeof trace === "string")
  );
}

function decodePayload(encoded: string): unknown {
  try {
    return JSON.parse(decodeBase64Url(encoded));
  } catch {
    return null;
  }
}

export function parseSummary(encoded: string): ParsedSummary | null {
  if (encoded.length === 0 || encoded.length > MAX_SUMMARY_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  const payload = decodePayload(encoded);
  if (
    !isRecord(payload) ||
    payload.v !== SUMMARY_VERSION ||
    !Array.isArray(payload.events) ||
    payload.events.length > SUMMARY_EVENT_LIMIT ||
    !payload.events.every(isEvent) ||
    !isEnvironment(payload.env) ||
    !(payload.token === null || typeof payload.token === "string")
  ) {
    return null;
  }
  return { events: payload.events, env: payload.env, token: payload.token };
}
