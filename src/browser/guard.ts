import { systemClock, type Clock } from "../core/clock";
import { EventLog } from "../core/log";
import { evaluate } from "../core/scorer";
import { buildSummary, SUMMARY_EVENT_LIMIT } from "../core/summary";
import type { EvidenceEvent, MarkerEvidence, Signal, Verdict } from "../core/types";
import { defaultSignals } from "../signals";
import { readEnvironment, startRecorder } from "./recorder";

export type GuardAction = "disable" | "message" | ((verdict: Verdict) => void);

export type GuardOptions = {
  mode: "detect" | "block";
  action?: GuardAction;
  message?: string;
  tokenEndpoint?: string;
  tokenTimeoutMs?: number;
  fieldName?: string;
  forms?: string;
  clock?: Clock;
  signals?: Signal[];
};

export type GuardCheck = { verdict: Verdict; summary: string };

export type Guard = {
  verdict(): Verdict;
  check(target?: Element): Promise<GuardCheck>;
  on(event: "verdict", callback: (verdict: Verdict) => void): () => void;
  destroy(): void;
};

export const DEFAULT_FIELD_NAME = "bag_summary";
export const DEFAULT_BLOCK_MESSAGE = "This action was blocked because it appears to be performed by an automated agent.";
const MESSAGE_ATTRIBUTE = "data-browser-agent-guard-message";
const VERDICT_THROTTLE_MS = 150;
export const DEFAULT_TOKEN_TIMEOUT_MS = 3000;

const UNSURE_BEFORE_INTERACTION: Verdict = { kind: "unsure", confidence: 0, reasons: [] };

function isForm(element: Element | null): element is HTMLFormElement {
  return element !== null && element.tagName === "FORM";
}

function formFor(target: Element | undefined): HTMLFormElement | null {
  if (target === undefined) {
    return null;
  }
  return isForm(target) ? target : target.closest("form");
}

function submitterOf(form: HTMLFormElement, candidate: Element | null | undefined): Element | null {
  return candidate !== null && candidate !== undefined && (candidate as HTMLButtonElement).form === form ? candidate : null;
}

function postsToOwnOrigin(form: HTMLFormElement, submitter: Element | null): boolean {
  const method = submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
  if (method.trim().toLowerCase() !== "post") {
    return false;
  }
  const action = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
  try {
    return new URL(action, form.ownerDocument.baseURI).origin === window.location.origin;
  } catch {
    return false;
  }
}

function assertValidSelector(selector: string): void {
  document.createDocumentFragment().querySelector(selector);
}

function sameVerdict(a: Verdict, b: Verdict): boolean {
  return a.kind === b.kind && a.agent === b.agent && a.confidence === b.confidence;
}

async function fetchToken(endpoint: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const token = (body as { token?: unknown } | null)?.token;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function writeSummaryField(form: HTMLFormElement, fieldName: string, summary: string): void {
  const existing = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).find(
    (input) => input.name === fieldName,
  );
  const field = existing ?? form.ownerDocument.createElement("input");
  field.type = "hidden";
  field.name = fieldName;
  field.value = summary;
  if (existing === undefined) {
    form.appendChild(field);
  }
}

function disable(target: Element): void {
  const controls = isForm(target) ? Array.from(target.elements) : [target];
  for (const control of controls) {
    if ("disabled" in control) {
      (control as HTMLButtonElement).disabled = true;
    }
  }
  target.setAttribute("aria-disabled", "true");
}

function showMessage(target: Element, message: string): void {
  const next = target.nextElementSibling;
  const element = next?.hasAttribute(MESSAGE_ATTRIBUTE) ? next : target.ownerDocument.createElement("p");
  element.setAttribute(MESSAGE_ATTRIBUTE, "");
  element.setAttribute("role", "alert");
  element.textContent = message;
  if (element !== next) {
    target.after(element);
  }
}

export function createGuard(options: GuardOptions): Guard {
  const clock = options.clock ?? systemClock;
  const signals = options.signals ?? defaultSignals;
  const fieldName = options.fieldName ?? DEFAULT_FIELD_NAME;
  const action = options.action ?? "disable";
  const formSelector = options.forms;
  if (formSelector !== undefined) {
    assertValidSelector(formSelector);
  }
  const isProtectedForm = (form: HTMLFormElement, submitter: Element | null): boolean =>
    (formSelector === undefined || form.matches(formSelector)) && postsToOwnOrigin(form, submitter);
  const log = new EventLog();
  const listeners = new Set<(verdict: Verdict) => void>();
  const resubmitting = new WeakSet<HTMLFormElement>();
  const pending = new WeakSet<HTMLFormElement>();
  const markerElements = new Map<Element, MarkerEvidence>();
  let lastEmitted: Verdict = UNSURE_BEFORE_INTERACTION;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  const liveMarkers = (): MarkerEvidence[] => {
    for (const element of markerElements.keys()) {
      if (!element.isConnected) {
        markerElements.delete(element);
      }
    }
    return [...markerElements.values()].slice(-SUMMARY_EVENT_LIMIT);
  };

  const recentEvents = (): EvidenceEvent[] => {
    const markers = liveMarkers();
    const included = new Set<EvidenceEvent>(markers);
    const others = log.all().filter((event) => !included.has(event));
    const recent = others.slice(Math.max(0, others.length - (SUMMARY_EVENT_LIMIT - markers.length)));
    return [...markers, ...recent].sort((a, b) => a.t - b.t);
  };

  const currentVerdict = (): Verdict => {
    const events = recentEvents();
    if (!events.some((event) => event.kind !== "marker")) {
      return UNSURE_BEFORE_INTERACTION;
    }
    return evaluate(events, readEnvironment(window), signals, { mode: options.mode });
  };

  const shouldBlock = (verdict: Verdict): boolean => options.mode === "block" && verdict.kind === "agent";

  const applyAction = (target: Element, verdict: Verdict): void => {
    if (typeof action === "function") {
      action(verdict);
    } else if (action === "message") {
      showMessage(target, options.message ?? DEFAULT_BLOCK_MESSAGE);
    } else {
      disable(target);
    }
  };

  const emitIfChanged = (): void => {
    throttleTimer = null;
    const verdict = currentVerdict();
    if (sameVerdict(verdict, lastEmitted)) {
      return;
    }
    lastEmitted = verdict;
    listeners.forEach((listener) => listener(verdict));
  };

  const scheduleEmit = (): void => {
    if (throttleTimer === null && listeners.size > 0) {
      throttleTimer = setTimeout(emitIfChanged, VERDICT_THROTTLE_MS);
    }
  };

  const check = async (target?: Element): Promise<GuardCheck> => {
    const token =
      options.tokenEndpoint === undefined
        ? null
        : await fetchToken(options.tokenEndpoint, options.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS);
    const verdict = currentVerdict();
    const summary = buildSummary(recentEvents(), readEnvironment(window), token);
    const form = formFor(target);
    if (form !== null && isProtectedForm(form, submitterOf(form, target))) {
      writeSummaryField(form, fieldName, summary);
    }
    if (target !== undefined && shouldBlock(verdict)) {
      applyAction(target, verdict);
    }
    return { verdict, summary };
  };

  const resubmit = (form: HTMLFormElement, submitter: HTMLElement | null): void => {
    resubmitting.add(form);
    try {
      form.requestSubmit(submitter !== null && (submitter as HTMLButtonElement).form === form ? submitter : undefined);
    } finally {
      resubmitting.delete(form);
    }
  };

  const onSubmit = (event: Event): void => {
    const form = event.target as Element | null;
    if (!isForm(form)) {
      return;
    }
    const submitter = (event as SubmitEvent).submitter;
    if (!isProtectedForm(form, submitterOf(form, submitter))) {
      return;
    }
    if (resubmitting.has(form)) {
      return;
    }
    if (pending.has(form)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const verdict = currentVerdict();
    if (shouldBlock(verdict)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyAction(form, verdict);
      return;
    }
    if (options.tokenEndpoint === undefined) {
      writeSummaryField(form, fieldName, buildSummary(recentEvents(), readEnvironment(window), null));
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    pending.add(form);
    void check(form)
      .then(
        (result) => !shouldBlock(result.verdict),
        () => options.mode !== "block",
      )
      .then((allowed) => {
        if (allowed) {
          resubmit(form, submitter);
        }
      })
      .finally(() => {
        pending.delete(form);
      });
  };

  const stopRecorder = startRecorder({
    log,
    clock,
    root: document,
    onEvent: scheduleEmit,
    onMarker: (marker, element) => {
      markerElements.set(element, marker);
    },
  });
  window.addEventListener("submit", onSubmit, true);

  return {
    verdict: currentVerdict,
    check,
    on(_event, callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy() {
      stopRecorder();
      window.removeEventListener("submit", onSubmit, true);
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      listeners.clear();
    },
  };
}
