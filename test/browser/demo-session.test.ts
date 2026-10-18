import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionToFixture, type SessionDetails } from "../../demo/session";
import { readEnvironment, startRecorder } from "../../src/browser/recorder";
import { EventLog } from "../../src/core/log";
import type { EvidenceEvent } from "../../src/core/types";
import type { Fixture } from "../fixtures";
import { steppingClock, stubRect, trusted, typeText } from "./dom-events";

const humanDetails: SessionDetails = {
  label: "human",
  agent: "",
  device: "desktop",
  notes: " Laptop trackpad ",
  idSuffix: "a1b2c3",
};

describe("sessionToFixture", () => {
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

  it("publishes no typed or pasted text from a recorded session", () => {
    const name = document.createElement("input");
    const notes = document.createElement("textarea");
    document.body.append(name, notes);
    stubRect(name, { x: 10.5, y: 20.5, w: 300, h: 38 });

    name.dispatchEvent(trusted(new PointerEvent("click", { pointerType: "mouse", detail: 1, clientX: 40.5, clientY: 30.5, bubbles: true })));
    typeText(name, "Zebulon Quixote");
    notes.value = "Secret pasted phrase";
    notes.dispatchEvent(trusted(new Event("paste", { bubbles: true })));
    notes.dispatchEvent(trusted(new InputEvent("input", { inputType: "insertFromPaste", data: "Secret pasted phrase", bubbles: true })));

    const fixture: Fixture = sessionToFixture(log.all(), readEnvironment(window), humanDetails);
    const published = JSON.stringify(fixture);

    expect(fixture.events.length).toBeGreaterThan(30);
    for (const fragment of ["Zebulon", "Quixote", "Secret", "pasted phrase", "KeyZ"]) {
      expect(published).not.toContain(fragment);
    }
    expect(published).not.toMatch(/"(key|code|value|data)":/);
  });

  it("keeps only the documented fields of each event", () => {
    const leaky = { kind: "key", t: 1000.56, trusted: true, printable: true, modifier: null, key: "q", code: "KeyQ" };
    const fixture = sessionToFixture([leaky as EvidenceEvent], { webdriver: false, automationTraces: [] }, humanDetails);

    expect(fixture.events).toEqual([{ kind: "key", t: 1000.6, trusted: true, printable: true, modifier: null }]);
  });

  it("drops events of unknown kinds", () => {
    const unknown = { kind: "clipboard", t: 1000.5, text: "copied words" };
    const fixture = sessionToFixture(
      [unknown as unknown as EvidenceEvent, { kind: "scroll", t: 1010.5, trusted: true }],
      { webdriver: false, automationTraces: [] },
      humanDetails,
    );

    expect(fixture.events).toEqual([{ kind: "scroll", t: 1010.5, trusted: true }]);
  });

  it("labels a human session without an agent name", () => {
    const fixture = sessionToFixture([], { webdriver: false, automationTraces: [] }, { ...humanDetails, agent: "Ignored" });

    expect(fixture).toEqual({
      id: "human-desktop-volunteer-a1b2c3",
      label: "human",
      device: "desktop",
      notes: "Laptop trackpad",
      consent: "volunteer",
      env: { webdriver: false, automationTraces: [] },
      events: [],
    });
  });

  it("labels an agent session with a normalised agent name", () => {
    const fixture = sessionToFixture([], { webdriver: true, automationTraces: ["__pwInitScripts"] }, {
      label: "agent",
      agent: "  My Browser Agent v2 ",
      device: "phone",
      notes: "",
      idSuffix: "ff00aa",
    });

    expect(fixture.id).toBe("my-browser-agent-v2-phone-volunteer-ff00aa");
    expect(fixture.agent).toBe("my-browser-agent-v2");
    expect(fixture.env).toEqual({ webdriver: true, automationTraces: ["__pwInitScripts"] });
  });

  it("sorts events by time", () => {
    const events: EvidenceEvent[] = [
      { kind: "scroll", t: 2000.5, trusted: true },
      { kind: "scroll", t: 1000.5, trusted: true },
    ];

    const fixture = sessionToFixture(events, { webdriver: false, automationTraces: [] }, humanDetails);

    expect(fixture.events.map((event) => event.t)).toEqual([1000.5, 2000.5]);
  });
});
