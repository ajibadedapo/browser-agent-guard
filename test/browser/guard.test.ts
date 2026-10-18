import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuard, DEFAULT_BLOCK_MESSAGE, type Guard, type GuardOptions } from "../../src/browser/guard";
import { parseSummary } from "../../src/core/summary";
import type { Verdict } from "../../src/core/types";
import { steppingClock, stubRect, trusted, typeText } from "./dom-events";

let guard: Guard | null = null;

function start(options: Omit<GuardOptions, "clock">): Guard {
  guard = createGuard({ ...options, clock: steppingClock() });
  return guard;
}

function buildForm(attributes: Record<string, string> = { method: "post" }): {
  form: HTMLFormElement;
  button: HTMLButtonElement;
  name: HTMLInputElement;
} {
  const form = document.createElement("form");
  for (const [attribute, value] of Object.entries(attributes)) {
    form.setAttribute(attribute, value);
  }
  const name = document.createElement("input");
  name.name = "name";
  const button = document.createElement("button");
  button.type = "submit";
  form.append(name, button);
  document.body.appendChild(form);
  return { form, button, name };
}

function addClaudeMarker(): void {
  const glow = document.createElement("div");
  glow.id = "claude-agent-glow-border";
  document.body.appendChild(glow);
}

function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clickAtCentre(target: HTMLElement): void {
  stubRect(target, { x: 100.5, y: 200.5, w: 80, h: 40 });
  target.dispatchEvent(
    trusted(new PointerEvent("click", { pointerType: "mouse", detail: 1, clientX: 140.5, clientY: 220.5, bubbles: true })),
  );
}

function submit(form: HTMLFormElement, submitter: HTMLElement | null = null): SubmitEvent {
  const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter });
  form.dispatchEvent(event);
  return event;
}

function summaryField(form: HTMLFormElement, name = "bag_summary"): HTMLInputElement | undefined {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).find((input) => input.name === name);
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
});

afterEach(() => {
  guard?.destroy();
  guard = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createGuard", () => {
  it("is unsure before any interaction", async () => {
    const current = start({ mode: "block" });
    addClaudeMarker();
    await flushMutations();

    expect(current.verdict()).toEqual({ kind: "unsure", confidence: 0, reasons: [] });
  });

  it("detect mode never prevents submit", async () => {
    const current = start({ mode: "detect" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);

    const event = submit(form, button);

    expect(current.verdict().kind).toBe("agent");
    expect(event.defaultPrevented).toBe(false);
    expect(button.disabled).toBe(false);
    const parsed = parseSummary(summaryField(form)?.value ?? "");
    expect(parsed?.events.map((evidence) => evidence.kind)).toEqual(["marker", "click"]);
    expect(parsed?.token).toBeNull();
  });

  it("block mode prevents submit when an agent marker is present and disables the form", async () => {
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);
    const laterListener = vi.fn();
    form.addEventListener("submit", laterListener);

    const event = submit(form, button);

    expect(current.verdict()).toMatchObject({ kind: "agent", agent: "claude-in-chrome" });
    expect(event.defaultPrevented).toBe(true);
    expect(laterListener).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(name.disabled).toBe(true);
    expect(form.getAttribute("aria-disabled")).toBe("true");
  });

  it("block mode blocks the submit started by clicking the submit button", async () => {
    start({ mode: "block" });
    const { form, button } = buildForm();
    addClaudeMarker();
    await flushMutations();
    const laterListener = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", laterListener);

    clickAtCentre(button);

    expect(laterListener).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
  });

  it("block mode does not block at page load", async () => {
    start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();

    const event = submit(form, button);

    expect(event.defaultPrevented).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("block mode lets a human looking session through", async () => {
    start({ mode: "block" });
    const { form, button, name } = buildForm();
    clickAtCentre(name);

    const event = submit(form, button);

    expect(event.defaultPrevented).toBe(false);
    expect(summaryField(form)).toBeDefined();
  });

  it("block mode does not block a marker when the behaviour is clearly human", async () => {
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    typeText(name, "Ada");

    const event = submit(form, button);

    expect(current.verdict().kind).toBe("unsure");
    expect(event.defaultPrevented).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("detect mode reports the marker and agent name when the behaviour is clearly human", async () => {
    const current = start({ mode: "detect" });
    const { name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    typeText(name, "Ada");

    expect(current.verdict()).toMatchObject({ kind: "agent", agent: "claude-in-chrome" });
  });

  it("ignores a marker id on user content inside an article", async () => {
    document.body.innerHTML = '<article><h2 id="claude-phantom-cursor">Phantom cursors</h2></article>';
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    clickAtCentre(name);

    const event = submit(form, button);

    expect(current.verdict().kind).not.toBe("agent");
    expect(event.defaultPrevented).toBe(false);
  });

  it("never touches a GET form in either mode", async () => {
    for (const mode of ["detect", "block"] as const) {
      document.body.innerHTML = "";
      const current = start({ mode });
      const { form, button, name } = buildForm({ method: "get", action: "/search" });
      addClaudeMarker();
      await flushMutations();
      clickAtCentre(name);

      const event = submit(form, button);

      expect(current.verdict().kind).toBe("agent");
      expect(event.defaultPrevented).toBe(false);
      expect(summaryField(form)).toBeUndefined();
      expect(button.disabled).toBe(false);
      current.destroy();
    }
  });

  it("treats a form with no method as GET", async () => {
    start({ mode: "detect" });
    const { form, button, name } = buildForm({});
    clickAtCentre(name);

    submit(form, button);

    expect(summaryField(form)).toBeUndefined();
  });

  it("never touches a POST form whose action is on another origin", async () => {
    for (const mode of ["detect", "block"] as const) {
      document.body.innerHTML = "";
      const current = start({ mode });
      const { form, button, name } = buildForm({ method: "post", action: "https://payments.example/charge" });
      addClaudeMarker();
      await flushMutations();
      clickAtCentre(name);

      const event = submit(form, button);

      expect(event.defaultPrevented).toBe(false);
      expect(summaryField(form)).toBeUndefined();
      expect(button.disabled).toBe(false);
      current.destroy();
    }
  });

  it("uses the submitter's formaction and formmethod", async () => {
    start({ mode: "block" });
    const { form, button, name } = buildForm({ method: "post", action: "/book" });
    button.setAttribute("formaction", "https://other.example/book");
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);

    const event = submit(form, button);

    expect(event.defaultPrevented).toBe(false);
    expect(summaryField(form)).toBeUndefined();
  });

  it("protects a same-origin POST form with an absolute action", async () => {
    start({ mode: "detect" });
    const { form, button, name } = buildForm({ method: "POST", action: "https://shop.example/api/book" });
    clickAtCentre(name);

    submit(form, button);

    expect(summaryField(form)).toBeDefined();
  });

  it("only protects forms matching the forms selector", async () => {
    start({ mode: "block", forms: "form[data-protected]" });
    const plain = buildForm();
    const protectedForm = buildForm({ method: "post", "data-protected": "" });
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(plain.name);

    const plainEvent = submit(plain.form, plain.button);
    const protectedEvent = submit(protectedForm.form, protectedForm.button);

    expect(plainEvent.defaultPrevented).toBe(false);
    expect(summaryField(plain.form)).toBeUndefined();
    expect(plain.button.disabled).toBe(false);
    expect(protectedEvent.defaultPrevented).toBe(true);
    expect(protectedForm.button.disabled).toBe(true);
  });

  it("rejects an invalid forms selector when the guard is created", () => {
    expect(() => start({ mode: "block", forms: "form[" })).toThrow();
  });

  it("check does not write the summary into a GET form", async () => {
    const current = start({ mode: "detect" });
    const { form, name } = buildForm({ method: "get" });
    clickAtCentre(name);

    const result = await current.check(form);

    expect(result.summary).not.toBe("");
    expect(summaryField(form)).toBeUndefined();
  });

  it("message action shows the configured message once", async () => {
    start({ mode: "block", action: "message", message: "Agents cannot book here." });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);

    submit(form, button);
    submit(form, button);

    const messages = document.querySelectorAll("[role=alert]");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.textContent).toBe("Agents cannot book here.");
    expect(button.disabled).toBe(false);
  });

  it("message action falls back to the default message", async () => {
    start({ mode: "block", action: "message" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);

    submit(form, button);

    expect(document.querySelector("[role=alert]")?.textContent).toBe(DEFAULT_BLOCK_MESSAGE);
  });

  it("custom action receives the verdict", async () => {
    const action = vi.fn<(verdict: Verdict) => void>();
    start({ mode: "block", action });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);

    submit(form, button);

    expect(action).toHaveBeenCalledWith(expect.objectContaining({ kind: "agent", agent: "claude-in-chrome" }));
  });

  it("fetches a token before submitting when a token endpoint is set", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "token-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    start({ mode: "detect", tokenEndpoint: "/agent-guard/token", fieldName: "guard" });
    const { form, button, name } = buildForm();
    clickAtCentre(name);
    const seen: Array<{ prevented: boolean; token: string | null | undefined }> = [];
    form.addEventListener("submit", (event) => {
      seen.push({ prevented: event.defaultPrevented, token: parseSummary(summaryField(form, "guard")?.value ?? "")?.token });
      event.preventDefault();
    });

    const first = submit(form, button);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(first.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/agent-guard/token", { method: "POST", credentials: "same-origin", signal: expect.any(Object) });
    expect(seen).toEqual([{ prevented: false, token: "token-1" }]);
  });

  it("resubmits once when the form is submitted again during a pending token fetch", async () => {
    let releaseToken: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (releaseToken = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    start({ mode: "detect", tokenEndpoint: "/agent-guard/token" });
    const { form, button, name } = buildForm();
    clickAtCentre(name);
    const siteListener = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", siteListener);

    const first = submit(form, button);
    const second = submit(form, button);
    releaseToken(new Response(JSON.stringify({ token: "token-1" }), { status: 200 }));
    await vi.waitFor(() => expect(siteListener).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(siteListener).toHaveBeenCalledTimes(1);
  });

  it("falls back to resubmitting in detect mode when the check fails, and clears pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "token-1" }), { status: 200 })));
    let calls = 0;
    const flakySignal = {
      id: "flaky",
      evaluate() {
        calls += 1;
        if (calls % 2 === 0) {
          throw new Error("signal failed");
        }
        return { id: "flaky", applicable: false, agentLikelihood: 0, weight: 1, reasons: [] };
      },
    };
    start({ mode: "detect", tokenEndpoint: "/agent-guard/token", signals: [flakySignal] });
    const { form, button, name } = buildForm();
    clickAtCentre(name);
    const siteListener = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", siteListener);

    submit(form, button);
    await vi.waitFor(() => expect(siteListener).toHaveBeenCalledTimes(1));
    submit(form, button);
    await vi.waitFor(() => expect(siteListener).toHaveBeenCalledTimes(2));
  });

  it("gives up on a slow token endpoint and submits with a null token", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const current = start({ mode: "detect", tokenEndpoint: "/agent-guard/token", tokenTimeoutMs: 500 });
    const { form, name } = buildForm();
    clickAtCentre(name);

    const result = current.check(form);
    await vi.advanceTimersByTimeAsync(499);
    expect(summaryField(form)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(parseSummary((await result).summary)?.token).toBeNull();
    expect(summaryField(form)).toBeDefined();
  });

  it("uses a 3000 ms token timeout by default", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const current = start({ mode: "detect", tokenEndpoint: "/agent-guard/token" });
    const { form } = buildForm();
    let settled = false;
    void current.check(form).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("keeps a connected marker in the evidence after 301 later events", async () => {
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    for (let index = 0; index < 301; index += 1) {
      document.dispatchEvent(trusted(new Event("scroll")));
    }
    clickAtCentre(name);

    const event = submit(form, button);
    const result = await current.check();

    expect(event.defaultPrevented).toBe(true);
    const parsed = parseSummary(result.summary);
    expect(parsed?.events).toHaveLength(300);
    expect(parsed?.events[0]).toMatchObject({ kind: "marker", marker: "#claude-agent-glow-border" });
  });

  it("drops a removed marker once it leaves the recent window", async () => {
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    document.getElementById("claude-agent-glow-border")?.remove();
    for (let index = 0; index < 301; index += 1) {
      document.dispatchEvent(trusted(new Event("scroll")));
    }
    clickAtCentre(name);

    const event = submit(form, button);

    expect(current.verdict().kind).not.toBe("agent");
    expect(event.defaultPrevented).toBe(false);
  });

  it("submits with a null token when the token endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const current = start({ mode: "detect", tokenEndpoint: "/agent-guard/token" });
    const { form, button, name } = buildForm();
    clickAtCentre(name);

    const result = await current.check(form);

    expect(parseSummary(result.summary)?.token).toBeNull();
    expect(summaryField(form)?.value).toBe(result.summary);
  });

  it("check on a protected element in block mode applies the action", async () => {
    const current = start({ mode: "block" });
    const link = document.createElement("button");
    document.body.appendChild(link);
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(link);

    const result = await current.check(link);

    expect(result.verdict.kind).toBe("agent");
    expect(link.disabled).toBe(true);
  });

  it("emits verdict changes after activity settles", async () => {
    vi.useFakeTimers();
    const current = start({ mode: "detect" });
    const { name } = buildForm();
    const received: Verdict[] = [];
    current.on("verdict", (verdict) => received.push(verdict));
    addClaudeMarker();
    await vi.advanceTimersByTimeAsync(0);
    clickAtCentre(name);

    await vi.advanceTimersByTimeAsync(200);

    expect(received.map((verdict) => verdict.kind)).toEqual(["agent"]);
  });

  it("destroy stops listening", async () => {
    const current = start({ mode: "block" });
    const { form, button, name } = buildForm();
    addClaudeMarker();
    await flushMutations();
    clickAtCentre(name);
    current.destroy();
    guard = null;

    const event = submit(form, button);

    expect(event.defaultPrevented).toBe(false);
  });
});
