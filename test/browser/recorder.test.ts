import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyField, readEnvironment, startRecorder } from "../../src/browser/recorder";
import { EventLog } from "../../src/core/log";
import { steppingClock, stubRect, trusted, typeText } from "./dom-events";

function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("startRecorder", () => {
  let log: EventLog;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    log = new EventLog();
    stop = startRecorder({ log, clock: steppingClock(), root: document });
  });

  afterEach(() => {
    stop();
  });

  it("records a click with rect and pointer type", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    stubRect(button, { x: 10.5, y: 20.5, w: 80, h: 40 });

    button.dispatchEvent(
      trusted(new PointerEvent("click", { pointerType: "mouse", detail: 1, clientX: 50.5, clientY: 40.5, bubbles: true })),
    );

    expect(log.all()).toEqual([
      {
        kind: "click",
        t: 1000.5,
        x: 50.5,
        y: 40.5,
        pointer: "mouse",
        trusted: true,
        rect: { x: 10.5, y: 20.5, w: 80, h: 40 },
      },
    ]);
  });

  it("records keyboard activated clicks as keyboard", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);

    button.dispatchEvent(trusted(new PointerEvent("click", { pointerType: "mouse", detail: 0, bubbles: true })));
    button.dispatchEvent(trusted(new PointerEvent("click", { pointerType: "", detail: 1, bubbles: true })));

    expect(log.all().map((event) => (event.kind === "click" ? event.pointer : null))).toEqual(["keyboard", "keyboard"]);
  });

  it("falls back to the last pointerdown type when a click has no pointerType", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);

    button.dispatchEvent(trusted(new MouseEvent("click", { detail: 1, bubbles: true })));
    button.dispatchEvent(trusted(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
    button.dispatchEvent(trusted(new MouseEvent("click", { detail: 1, bubbles: true })));
    button.dispatchEvent(trusted(new MouseEvent("click", { detail: 0, bubbles: true })));

    expect(log.all().map((event) => (event.kind === "click" ? event.pointer : event.kind))).toEqual([
      "mouse",
      "down",
      "touch",
      "keyboard",
    ]);
  });

  it("ignores unknown added elements but records claude markers", async () => {
    const extensionOverlay = document.createElement("div");
    extensionOverlay.id = "some-extension-root";
    document.body.appendChild(extensionOverlay);
    const wrapper = document.createElement("div");
    const glow = document.createElement("div");
    glow.id = "claude-agent-glow-border";
    wrapper.appendChild(glow);
    document.body.appendChild(wrapper);
    const cursor = document.createElement("div");
    cursor.id = "claude-phantom-cursor";
    document.body.appendChild(cursor);
    const lookalike = document.createElement("div");
    lookalike.id = "claude-agent-glow-border-copy";
    document.body.appendChild(lookalike);

    await flushMutations();

    expect(log.all().map((event) => (event.kind === "marker" ? [event.agent, event.marker] : event.kind))).toEqual([
      ["claude-in-chrome", "#claude-agent-glow-border"],
      ["claude-in-chrome", "#claude-phantom-cursor"],
    ]);
  });

  it("records markers already present when recording starts", () => {
    stop();
    const overlay = document.createElement("div");
    overlay.id = "codex-agent-overlay-root";
    document.body.appendChild(overlay);

    stop = startRecorder({ log, clock: steppingClock(), root: document });

    expect(log.all()).toEqual([
      { kind: "marker", t: 1000.5, agent: "chatgpt-agent", marker: "#codex-agent-overlay-root" },
    ]);
  });

  it("ignores a marker id on user content that was on the page before recording started", () => {
    stop();
    document.body.innerHTML = '<article><h2 id="claude-phantom-cursor">How I built a phantom cursor</h2></article>';

    stop = startRecorder({ log, clock: steppingClock(), root: document });

    expect(log.all()).toEqual([]);
  });

  it("records a marker style already in the head when recording starts", () => {
    stop();
    const style = document.createElement("style");
    style.id = "claude-agent-animation-styles";
    document.head.appendChild(style);

    stop = startRecorder({ log, clock: steppingClock(), root: document });
    style.remove();

    expect(log.all()).toEqual([
      { kind: "marker", t: 1000.5, agent: "claude-in-chrome", marker: "#claude-agent-animation-styles" },
    ]);
  });

  it("never records typed characters", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    typeText(input, "secret");
    input.dispatchEvent(trusted(new Event("change", { bubbles: true })));

    const serialized = JSON.stringify(log.all());
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toMatch(/"(key|code|data|value)":/);
    expect(log.all().filter((event) => event.kind === "key")).toHaveLength(6);
    expect(log.all().at(-2)).toEqual({
      kind: "input",
      t: expect.any(Number),
      trusted: true,
      inputType: "insertText",
      length: 6,
      field: "text",
    });
  });

  it("ignores held key auto repeat", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    input.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    input.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true })));
    input.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true })));

    expect(log.all()).toEqual([
      { kind: "key", t: 1000.5, trusted: true, printable: true, modifier: null },
      { kind: "key", t: 1021, trusted: true, printable: false, modifier: "meta" },
    ]);
  });

  it("records untrusted paste and change without content", () => {
    const input = document.createElement("input");
    input.setAttribute("autocomplete", "off");
    document.body.appendChild(input);
    const select = document.createElement("select");
    document.body.appendChild(select);

    input.dispatchEvent(new Event("paste", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(log.all()).toEqual([
      { kind: "paste", t: 1000.5, trusted: false, field: "text" },
      { kind: "change", t: 1010.75, trusted: false, field: "select" },
    ]);
  });

  it("does not record the length of credential fields", () => {
    const password = document.createElement("input");
    password.type = "password";
    document.body.appendChild(password);
    password.value = "hunter22";

    password.dispatchEvent(new InputEvent("input", { inputType: "insertText", bubbles: true }));

    expect(log.all()).toEqual([
      { kind: "input", t: 1000.5, trusted: false, inputType: "insertText", length: null, field: "credential" },
    ]);
  });

  it("records no key events typed into a password field", () => {
    const password = document.createElement("input");
    password.type = "password";
    document.body.appendChild(password);

    typeText(password, "hunter22");

    expect(log.all().filter((event) => event.kind === "key")).toEqual([]);
  });

  it("leaves no per-character trace when typing a password", () => {
    const password = document.createElement("input");
    password.type = "password";
    document.body.appendChild(password);

    typeText(password, "hunter2");

    expect(log.all()).toEqual([]);
  });

  it("coalesces untrusted credential inputs to one per field per second", () => {
    stop();
    let now = 1000.5;
    stop = startRecorder({ log, clock: () => now, root: document });
    const password = document.createElement("input");
    password.type = "password";
    const username = document.createElement("input");
    username.setAttribute("autocomplete", "username");
    document.body.append(password, username);

    for (const step of [0, 120, 240, 999]) {
      now = 1000.5 + step;
      password.dispatchEvent(new InputEvent("input", { inputType: "insertText", bubbles: true }));
    }
    username.dispatchEvent(new InputEvent("input", { inputType: "insertText", bubbles: true }));
    now = 2000.5;
    password.dispatchEvent(new InputEvent("input", { inputType: "insertText", bubbles: true }));

    expect(log.all()).toEqual([
      { kind: "input", t: 1000.5, trusted: false, inputType: "insertText", length: null, field: "credential" },
      { kind: "input", t: 1999.5, trusted: false, inputType: "insertText", length: null, field: "credential" },
      { kind: "input", t: 2000.5, trusted: false, inputType: "insertText", length: null, field: "credential" },
    ]);
  });

  it("records no key events typed into an email field", () => {
    const email = document.createElement("input");
    email.type = "email";
    document.body.appendChild(email);

    typeText(email, "ada@example.com");

    expect(log.all().filter((event) => event.kind === "key")).toEqual([]);
    expect(log.all().filter((event) => event.kind === "input")).toEqual([]);
  });

  it("records trusted moves only and maps touch", () => {
    document.body.dispatchEvent(trusted(new PointerEvent("pointermove", { pointerType: "touch", clientX: 1.5, clientY: 2.5, bubbles: true })));
    document.body.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: 3.5, clientY: 4.5, bubbles: true }));

    expect(log.all()).toEqual([{ kind: "move", t: 1000.5, x: 1.5, y: 2.5, pointer: "touch" }]);
  });

  it("stops recording after the stop function runs", async () => {
    stop();
    document.body.dispatchEvent(trusted(new Event("scroll")));
    const glow = document.createElement("div");
    glow.id = "claude-agent-glow-border";
    document.body.appendChild(glow);
    await flushMutations();

    expect(log.size()).toBe(0);
  });
});

describe("classifyField", () => {
  function element(html: string): Element {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container.firstElementChild as Element;
  }

  it.each([
    ['<input type="password">', "credential"],
    ['<input autocomplete="username">', "credential"],
    ['<input type="email" autocomplete="email">', "credential"],
    ['<input autocomplete="shipping street-address">', "credential"],
    ['<input autocomplete="cc-number">', "credential"],
    ['<select autocomplete="country"></select>', "credential"],
    ['<input type="email" autocomplete="off">', "credential"],
    ['<input autocomplete="address-level1">', "credential"],
    ['<input autocomplete="shipping address-level2">', "credential"],
    ['<input autocomplete="bday">', "credential"],
    ['<input autocomplete="organization">', "credential"],
    ['<input type="text" autocomplete="off">', "text"],
    ["<input>", "text"],
    ["<textarea></textarea>", "text"],
    ["<select></select>", "select"],
    ['<input type="checkbox">', "checkbox"],
    ['<input type="radio">', "checkbox"],
    ['<input type="range">', "other"],
    ["<button></button>", "other"],
  ])("classifies %s as %s", (html, kind) => {
    expect(classifyField(element(html))).toBe(kind);
  });
});

describe("readEnvironment", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__playwright__binding__;
    delete (document as unknown as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
  });

  it("reports nothing on a clean page", () => {
    expect(readEnvironment(window)).toEqual({ webdriver: false, automationTraces: [] });
  });

  it("reports navigator.webdriver", () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });

    expect(readEnvironment(window).webdriver).toBe(true);
  });

  it("lists known automation globals and chromedriver document keys", () => {
    (window as unknown as Record<string, unknown>).__playwright__binding__ = {};
    (document as unknown as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

    expect(readEnvironment(window).automationTraces).toEqual([
      "__playwright__binding__",
      "document.$cdc_asdjflasutopfhvcZLmcfl_",
    ]);
  });
});
