import type { Clock } from "../core/clock";
import type { EventLog } from "../core/log";
import type { ElementRect, Environment, EvidenceEvent, FieldKind, MarkerEvidence, PointerKind } from "../core/types";
import { KNOWN_MARKERS } from "../signals/markers-list";

export type RecorderOptions = {
  log: EventLog;
  clock: Clock;
  root?: Document;
  onEvent?: (event: EvidenceEvent) => void;
  onMarker?: (marker: MarkerEvidence, element: Element) => void;
};

const AUTOMATION_GLOBALS = [
  "__playwright__binding__",
  "__pwInitScripts",
  "callPhantom",
  "_phantom",
  "__nightmare",
  "domAutomation",
  "domAutomationController",
];

const CHROMEDRIVER_KEY = /^\$?cdc_/;

const AUTOFILL_TOKENS = [
  "username",
  "current-password",
  "new-password",
  "one-time-code",
  "email",
  "name",
  "given-name",
  "family-name",
  "tel",
  "street-address",
  "address-line1",
  "address-line2",
  "address-level1",
  "address-level2",
  "postal-code",
  "country",
  "cc-name",
  "cc-number",
  "cc-exp",
  "cc-csc",
  "bday",
  "organization",
];

const CREDENTIAL_INPUT_TYPES = new Set(["password", "email"]);
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "number", ""]);

const markersById = new Map(KNOWN_MARKERS.map((marker) => [marker.selector.slice(1), marker]));
const markerSelector = KNOWN_MARKERS.map((marker) => marker.selector).join(",");

export function readEnvironment(win: Window): Environment {
  const traces = AUTOMATION_GLOBALS.filter((name) => name in win);
  for (const key of Object.keys(win.document)) {
    if (CHROMEDRIVER_KEY.test(key)) {
      traces.push(`document.${key}`);
    }
  }
  return { webdriver: win.navigator.webdriver === true, automationTraces: traces };
}

function isElement(target: EventTarget | null): target is Element {
  return target !== null && (target as Node).nodeType === 1;
}

function hasAutofillToken(element: Element): boolean {
  const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase();
  return AUTOFILL_TOKENS.some((token) => autocomplete.includes(token));
}

export function classifyField(target: EventTarget | null): FieldKind {
  if (!isElement(target)) {
    return "other";
  }
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
    return "other";
  }
  const type = (target.getAttribute("type") ?? "").toLowerCase();
  if (CREDENTIAL_INPUT_TYPES.has(type) || hasAutofillToken(target)) {
    return "credential";
  }
  if (tag === "SELECT") {
    return "select";
  }
  if (tag === "TEXTAREA" || TEXT_INPUT_TYPES.has(type)) {
    return "text";
  }
  if (type === "checkbox" || type === "radio") {
    return "checkbox";
  }
  return "other";
}

function pointerKind(event: Event): PointerKind {
  const type = (event as PointerEvent).pointerType;
  if (type === "mouse" || type === "touch" || type === "pen") {
    return type;
  }
  return "keyboard";
}

function clickPointerKind(event: MouseEvent, lastPointerDown: PointerKind | null): PointerKind {
  if (event.detail === 0) {
    return "keyboard";
  }
  if ((event as Partial<PointerEvent>).pointerType === undefined) {
    return lastPointerDown ?? "mouse";
  }
  return pointerKind(event);
}

function rectOf(target: EventTarget | null): ElementRect {
  if (!isElement(target)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const rect = target.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function valueLength(target: EventTarget | null, field: FieldKind): number | null {
  if (field === "credential" || !isElement(target)) {
    return null;
  }
  const value = (target as HTMLInputElement).value;
  return typeof value === "string" ? value.length : null;
}

export function toEvidence(event: Event, t: number, lastPointerDown: PointerKind | null = null): EvidenceEvent | null {
  const trusted = event.isTrusted === true;
  switch (event.type) {
    case "pointermove": {
      const move = event as PointerEvent;
      return trusted ? { kind: "move", t, x: move.clientX, y: move.clientY, pointer: pointerKind(move) } : null;
    }
    case "pointerdown":
    case "click": {
      const press = event as MouseEvent;
      return {
        kind: event.type === "click" ? "click" : "down",
        t,
        x: press.clientX,
        y: press.clientY,
        pointer: event.type === "click" ? clickPointerKind(press, lastPointerDown) : pointerKind(press),
        trusted,
        rect: rectOf(event.target),
      };
    }
    case "keydown": {
      const key = event as KeyboardEvent;
      if (key.repeat || classifyField(event.target) === "credential") {
        return null;
      }
      const modifier = key.metaKey ? "meta" : key.ctrlKey ? "ctrl" : null;
      return { kind: "key", t, trusted, printable: modifier === null && key.key?.length === 1, modifier };
    }
    case "input": {
      const field = classifyField(event.target);
      if (field === "credential" && trusted) {
        return null;
      }
      const inputType = (event as InputEvent).inputType;
      return {
        kind: "input",
        t,
        trusted,
        inputType: inputType ? inputType : null,
        length: valueLength(event.target, field),
        field,
      };
    }
    case "paste":
    case "change":
      return { kind: event.type, t, trusted, field: classifyField(event.target) };
    case "scroll":
      return { kind: "scroll", t, trusted };
    default:
      return null;
  }
}

const CREDENTIAL_INPUT_COALESCE_MS = 1000;

const RECORDED_EVENTS = ["pointermove", "pointerdown", "click", "keydown", "input", "paste", "change", "scroll"];

export function startRecorder(options: RecorderOptions): () => void {
  const root = options.root ?? document;
  const seenMarkers = new WeakSet<Element>();
  const lastCredentialInput = new WeakMap<EventTarget, number>();
  let lastPointerDown: PointerKind | null = null;

  const isCoalescedCredentialInput = (event: Event, evidence: EvidenceEvent): boolean => {
    if (evidence.kind !== "input" || evidence.field !== "credential" || event.target === null) {
      return false;
    }
    const previous = lastCredentialInput.get(event.target);
    if (previous !== undefined && evidence.t - previous < CREDENTIAL_INPUT_COALESCE_MS) {
      return true;
    }
    lastCredentialInput.set(event.target, evidence.t);
    return false;
  };

  const record = (evidence: EvidenceEvent): void => {
    options.log.push(evidence);
    options.onEvent?.(evidence);
  };

  const onEvent = (event: Event): void => {
    const evidence = toEvidence(event, options.clock(), lastPointerDown);
    if (evidence === null || isCoalescedCredentialInput(event, evidence)) {
      return;
    }
    if (evidence.kind === "down") {
      lastPointerDown = evidence.pointer;
    }
    record(evidence);
  };

  const recordMarker = (element: Element): void => {
    const marker = markersById.get(element.id);
    if (marker === undefined || seenMarkers.has(element)) {
      return;
    }
    seenMarkers.add(element);
    const evidence: MarkerEvidence = { kind: "marker", t: options.clock(), agent: marker.agent, marker: marker.selector };
    record(evidence);
    options.onMarker?.(evidence, element);
  };

  const inspect = (node: Node): void => {
    if (!isElement(node)) {
      return;
    }
    recordMarker(node);
    if (node.firstElementChild !== null) {
      node.querySelectorAll(markerSelector).forEach(recordMarker);
    }
  };

  const isTopLevel = (element: Element): boolean => {
    const parent = element.parentElement;
    return parent !== null && (parent === root.documentElement || parent === root.body || parent === root.head);
  };

  for (const id of markersById.keys()) {
    const element = root.getElementById(id);
    if (element !== null && isTopLevel(element)) {
      recordMarker(element);
    }
  }

  const observer = new (root.defaultView ?? window).MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(inspect);
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  const listenerOptions = { capture: true, passive: true };
  for (const type of RECORDED_EVENTS) {
    root.addEventListener(type, onEvent, listenerOptions);
  }

  return () => {
    observer.disconnect();
    for (const type of RECORDED_EVENTS) {
      root.removeEventListener(type, onEvent, listenerOptions);
    }
  };
}
