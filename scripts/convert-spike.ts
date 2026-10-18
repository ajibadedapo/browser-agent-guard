import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElementRect, EvidenceEvent, FieldKind, PointerKind } from "../src/core/types";
import type { Fixture } from "../test/fixtures";

type SpikeEvent = {
  t: number;
  type: string;
  target?: string;
  trusted?: boolean;
  pointerType?: string | null;
  x?: number;
  y?: number;
  offsetFromCentre?: [number, number] | null;
  key?: string;
  inputType?: string | null;
  valueLength?: number | null;
};

type SpikeMutation = { t: number; kind: string; node: string; attrs?: string[] | null };

type SpikeMove = { t: number; x: number; y: number; trusted: boolean };

type SpikeSession = {
  who: string;
  environment: { webdriver: boolean };
  totals: { moves: number };
  events: SpikeEvent[];
  mutations: SpikeMutation[];
  moveSample: SpikeMove[];
};

type SessionPlan = {
  who: string;
  id: string;
  label: "human" | "agent";
  agent?: string;
  nomarkersId?: string;
  description: string;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const spikePath = join(repoRoot, "research/spike-2026-10-18/sessions.json");
const outputDirectory = join(repoRoot, "fixtures/sessions");

const plans: SessionPlan[] = [
  {
    who: "claude-clicks",
    id: "claude-in-chrome-001",
    label: "agent",
    agent: "claude-in-chrome",
    nomarkersId: "claude-in-chrome-nomarkers-001",
    description: "Claude in Chrome completing the spike booking task, then opening item 25.",
  },
  {
    who: "chatgpt-agent",
    id: "chatgpt-agent-001",
    label: "agent",
    agent: "chatgpt-agent",
    nomarkersId: "chatgpt-agent-nomarkers-001",
    description: "ChatGPT agent (Chrome extension) completing the spike booking task, then opening item 25.",
  },
  {
    who: "human",
    id: "human-desktop-001",
    label: "human",
    description: "Hammed completing the spike booking task by hand with a mouse and keyboard.",
  },
];

const CONTENT_WIDTH = 728;

const approximateSizes: Array<{ prefix: string; w: number; h: number }> = [
  { prefix: "input#terms", w: 13, h: 13 },
  { prefix: "input#", w: CONTENT_WIDTH, h: 38 },
  { prefix: "select#", w: CONTENT_WIDTH, h: 38 },
  { prefix: "textarea#", w: CONTENT_WIDTH, h: 78 },
  { prefix: "button#", w: 76, h: 43 },
  { prefix: "a#item-", w: CONTENT_WIDTH, h: 48 },
  { prefix: "label", w: CONTENT_WIDTH, h: 20 },
];

const fallbackSize = { w: 100, h: 40 };

const fieldKinds: Record<string, FieldKind> = {
  "input#email": "text",
  "input#name": "text",
  "textarea#notes": "text",
  "select#time": "select",
  "input#terms": "checkbox",
};

const markerAgents: Record<string, string> = {
  "claude-agent-glow-border": "claude-in-chrome",
  "claude-phantom-cursor": "claude-in-chrome",
  "claude-agent-animation-styles": "claude-in-chrome",
  "codex-agent-overlay-root": "chatgpt-agent",
};

function fieldKind(target: string | undefined): FieldKind {
  return (target && fieldKinds[target]) || "other";
}

function pointerKind(pointerType: string | null | undefined): PointerKind {
  if (pointerType === "touch" || pointerType === "pen" || pointerType === "mouse") {
    return pointerType;
  }
  return "keyboard";
}

function reconstructRect(event: SpikeEvent): ElementRect {
  const size = approximateSizes.find((entry) => (event.target ?? "").startsWith(entry.prefix)) ?? fallbackSize;
  const [offsetX, offsetY] = event.offsetFromCentre ?? [0, 0];
  const x = event.x ?? 0;
  const y = event.y ?? 0;
  const centreX = x - offsetX * size.w;
  const centreY = y - offsetY * size.h;
  return { x: round(centreX - size.w / 2), y: round(centreY - size.h / 2), w: size.w, h: size.h };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function keyModifier(key: string | undefined): "meta" | "ctrl" | null {
  if (key === "Meta") return "meta";
  if (key === "Control") return "ctrl";
  return null;
}

function convertEvent(event: SpikeEvent): EvidenceEvent | null {
  const trusted = event.trusted === true;
  switch (event.type) {
    case "pointerdown":
    case "click":
      return {
        kind: event.type === "pointerdown" ? "down" : "click",
        t: event.t,
        x: event.x ?? 0,
        y: event.y ?? 0,
        pointer: pointerKind(event.pointerType),
        trusted,
        rect: reconstructRect(event),
      };
    case "keydown":
      return { kind: "key", t: event.t, trusted, printable: event.key === "char", modifier: keyModifier(event.key) };
    case "input":
      return {
        kind: "input",
        t: event.t,
        trusted,
        inputType: event.inputType ?? null,
        length: event.valueLength ?? null,
        field: fieldKind(event.target),
      };
    case "paste":
      return { kind: "paste", t: event.t, trusted, field: fieldKind(event.target) };
    case "change":
      return { kind: "change", t: event.t, trusted, field: fieldKind(event.target) };
    case "scroll":
      return { kind: "scroll", t: event.t, trusted };
    default:
      return null;
  }
}

function addedElementId(mutation: SpikeMutation): string | null {
  const idAttribute = (mutation.attrs ?? []).find((attribute) => attribute.startsWith("id="));
  return idAttribute ? idAttribute.slice("id=".length) : null;
}

function convertMarkers(mutations: SpikeMutation[]): EvidenceEvent[] {
  return mutations.flatMap((mutation) => {
    if (mutation.kind !== "added") return [];
    const id = addedElementId(mutation);
    const agent = id && Object.hasOwn(markerAgents, id) ? markerAgents[id] : undefined;
    return id && agent ? [{ kind: "marker" as const, t: mutation.t, agent, marker: `#${id}` }] : [];
  });
}

function convertMoves(moves: SpikeMove[]): EvidenceEvent[] {
  return moves.map((move) => ({ kind: "move" as const, t: move.t, x: move.x, y: move.y, pointer: "mouse" as const }));
}

function moveNotes(session: SpikeSession): string {
  const lost = session.totals.moves - session.moveSample.length;
  const firstSampled = session.moveSample[0]?.t;
  if (lost <= 0) return `All ${session.totals.moves} pointer moves were kept.`;
  return `The spike kept only the last ${session.moveSample.length} of ${session.totals.moves} pointer moves, so ${lost} moves before t=${firstSampled} ms are lost.`;
}

function buildNotes(plan: SessionPlan, session: SpikeSession, withoutMarkers: boolean): string {
  return [
    plan.description,
    "Converted from research/spike-2026-10-18/sessions.json by scripts/convert-spike.ts.",
    moveNotes(session),
    "Move events come from the spike's move sample, which has no pointer type; they are recorded as mouse.",
    "Press rects are reconstructed from offsetFromCentre with approximate element sizes taken from the spike page CSS, so rect x and y are exact relative to the recorded offset but w and h are estimates.",
    "Only pointerdown and click are kept as presses; mouse and pointerup events are dropped. A null or empty pointer type (keyboard or assistive technology activation) is recorded as keyboard.",
    "Input length is the field value length after the input, never the content.",
    "Key and code identities were scrubbed in the spike; printable comes from the spike's char marker.",
    withoutMarkers ? "Agent page markers removed to test behavioural detection alone." : "",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function sortByTime(events: EvidenceEvent[]): EvidenceEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index)
    .map((entry) => entry.event);
}

function buildFixtures(plan: SessionPlan, session: SpikeSession): Fixture[] {
  const behaviour = session.events.map(convertEvent).filter((event): event is EvidenceEvent => event !== null);
  const events = sortByTime([...convertMoves(session.moveSample), ...behaviour, ...convertMarkers(session.mutations)]);
  const base = {
    label: plan.label,
    ...(plan.agent ? { agent: plan.agent } : {}),
    device: "desktop" as const,
    consent: "author" as const,
    env: { webdriver: session.environment.webdriver === true, automationTraces: [] },
  };
  const fixtures: Fixture[] = [{ id: plan.id, ...base, notes: buildNotes(plan, session, false), events }];
  if (plan.nomarkersId) {
    fixtures.push({
      id: plan.nomarkersId,
      ...base,
      notes: buildNotes(plan, session, true),
      events: events.filter((event) => event.kind !== "marker"),
    });
  }
  return fixtures;
}

function orderedFixture(fixture: Fixture): Fixture {
  const { id, label, agent, device, notes, consent, env, events } = fixture;
  return { id, label, ...(agent ? { agent } : {}), device, notes, consent, env, events };
}

function main(): void {
  const sessions = JSON.parse(readFileSync(spikePath, "utf8")) as SpikeSession[];
  mkdirSync(outputDirectory, { recursive: true });
  for (const plan of plans) {
    const session = sessions.find((candidate) => candidate.who === plan.who);
    if (!session) throw new Error(`Spike session "${plan.who}" not found in ${spikePath}`);
    for (const fixture of buildFixtures(plan, session)) {
      const path = join(outputDirectory, `${fixture.id}.json`);
      writeFileSync(path, `${JSON.stringify(orderedFixture(fixture), null, 2)}\n`);
      console.log(`${fixture.id}: ${fixture.events.length} events`);
    }
  }
}

main();
