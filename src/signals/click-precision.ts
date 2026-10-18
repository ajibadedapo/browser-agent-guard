import type { PressEvidence, Signal, SignalResult } from "../core/types";
import { MINIMUM_MOUSE_CLICKS, POINTER_SIGNAL_GROUP, mouseClickDecisions } from "./clicks";
import { median, rampFromAgentToHuman } from "./stats";

const CLICK_PRECISION_WEIGHT = 1;
const CENTRED_MEDIAN_OFFSET = 0.05;
const HUMAN_MEDIAN_OFFSET = 0.2;

function offsetFromCentre(click: PressEvidence): number {
  const { x, y, w, h } = click.rect;
  const distance = Math.hypot(click.x - (x + w / 2), click.y - (y + h / 2));
  return distance / Math.hypot(w, h);
}

export const clickPrecisionSignal: Signal = {
  id: "click-precision",
  evaluate(events): SignalResult {
    const clicks = mouseClickDecisions(events).filter((click) => click.rect.w > 0 && click.rect.h > 0);
    if (clicks.length < MINIMUM_MOUSE_CLICKS) {
      return {
        id: "click-precision",
        applicable: false,
        agentLikelihood: 0,
        weight: CLICK_PRECISION_WEIGHT,
        group: POINTER_SIGNAL_GROUP,
        reasons: clicks.length === 0 ? [] : [`only ${clicks.length} mouse clicks, too few to judge click precision`],
      };
    }
    const medianOffset = median(clicks.map(offsetFromCentre));
    const percent = Number((medianOffset * 100).toFixed(1));
    return {
      id: "click-precision",
      applicable: true,
      agentLikelihood: rampFromAgentToHuman(medianOffset, CENTRED_MEDIAN_OFFSET, HUMAN_MEDIAN_OFFSET),
      weight: CLICK_PRECISION_WEIGHT,
      group: POINTER_SIGNAL_GROUP,
      reasons: [`median click ${percent}% of the element size from the centre over ${clicks.length} mouse clicks`],
    };
  },
};
