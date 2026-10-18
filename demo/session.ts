import type { Environment, EvidenceEvent } from "../src/index";

export type SessionLabel = "human" | "agent";

export type SessionDevice = "desktop" | "phone" | "tablet";

export type SessionFixture = {
  id: string;
  label: SessionLabel;
  agent?: string;
  device: SessionDevice;
  notes: string;
  consent: "volunteer";
  env: Environment;
  events: EvidenceEvent[];
};

export type SessionDetails = {
  label: SessionLabel;
  agent: string;
  device: SessionDevice;
  notes: string;
  idSuffix: string;
};

function roundTime(t: number): number {
  return Math.round(t * 10) / 10;
}

function copyEvent(event: EvidenceEvent): EvidenceEvent | null {
  const t = roundTime(event.t);
  switch (event.kind) {
    case "move":
      return { kind: "move", t, x: event.x, y: event.y, pointer: event.pointer };
    case "down":
    case "click":
      return {
        kind: event.kind,
        t,
        x: event.x,
        y: event.y,
        pointer: event.pointer,
        trusted: event.trusted,
        rect: { x: event.rect.x, y: event.rect.y, w: event.rect.w, h: event.rect.h },
      };
    case "key":
      return { kind: "key", t, trusted: event.trusted, printable: event.printable, modifier: event.modifier };
    case "input":
      return {
        kind: "input",
        t,
        trusted: event.trusted,
        inputType: event.inputType,
        length: event.length,
        field: event.field,
      };
    case "paste":
    case "change":
      return { kind: event.kind, t, trusted: event.trusted, field: event.field };
    case "scroll":
      return { kind: "scroll", t, trusted: event.trusted };
    case "marker":
      return { kind: "marker", t, agent: event.agent, marker: event.marker };
    default:
      return null;
  }
}

function isPresent(event: EvidenceEvent | null): event is EvidenceEvent {
  return event !== null;
}

export function agentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function fixtureId(details: SessionDetails): string {
  const subject = details.label === "agent" ? agentSlug(details.agent) || "agent" : "human";
  return `${subject}-${details.device}-volunteer-${details.idSuffix}`;
}

export function sessionToFixture(events: EvidenceEvent[], env: Environment, details: SessionDetails): SessionFixture {
  const agent = details.label === "agent" ? agentSlug(details.agent) : "";
  return {
    id: fixtureId(details),
    label: details.label,
    ...(agent === "" ? {} : { agent }),
    device: details.device,
    notes: details.notes.trim(),
    consent: "volunteer",
    env: { webdriver: env.webdriver, automationTraces: [...env.automationTraces] },
    events: events.map(copyEvent).filter(isPresent).sort((a, b) => a.t - b.t),
  };
}
