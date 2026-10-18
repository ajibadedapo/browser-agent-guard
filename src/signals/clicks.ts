import type { EvidenceEvent, PressEvidence } from "../core/types";

const SAME_DECISION_WINDOW_MS = 50;
export const MINIMUM_MOUSE_CLICKS = 3;
export const POINTER_SIGNAL_GROUP = "pointer";

export function clickDecisions(events: EvidenceEvent[]): PressEvidence[] {
  const decisions: PressEvidence[] = [];
  for (const event of events) {
    if (event.kind !== "click") {
      continue;
    }
    const previous = decisions[decisions.length - 1];
    if (previous !== undefined && event.t - previous.t <= SAME_DECISION_WINDOW_MS) {
      continue;
    }
    decisions.push(event);
  }
  return decisions;
}

export function mouseClickDecisions(events: EvidenceEvent[]): PressEvidence[] {
  return clickDecisions(events.filter((event) => event.kind === "click" && event.pointer === "mouse"));
}
