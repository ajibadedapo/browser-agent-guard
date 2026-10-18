import type { Signal, SignalResult } from "../core/types";
import { MINIMUM_MOUSE_CLICKS, POINTER_SIGNAL_GROUP, mouseClickDecisions } from "./clicks";
import { median, rampFromAgentToHuman } from "./stats";

const POINTER_PATH_WEIGHT = 1;
const MOVE_WINDOW_MS = 1000;
const TELEPORT_MEDIAN_MOVES = 2;
const HUMAN_MEDIAN_MOVES = 10;

export const pointerPathSignal: Signal = {
  id: "pointer-path",
  evaluate(events): SignalResult {
    const clicks = mouseClickDecisions(events);
    if (clicks.length < MINIMUM_MOUSE_CLICKS) {
      return {
        id: "pointer-path",
        applicable: false,
        agentLikelihood: 0,
        weight: POINTER_PATH_WEIGHT,
        group: POINTER_SIGNAL_GROUP,
        reasons: clicks.length === 0 ? [] : [`only ${clicks.length} mouse clicks, too few to judge pointer paths`],
      };
    }
    const mouseMoveTimes = events.flatMap((event) =>
      event.kind === "move" && event.pointer === "mouse" ? [event.t] : [],
    );
    const movesBeforeEachClick = clicks.map(
      (click) => mouseMoveTimes.filter((t) => t >= click.t - MOVE_WINDOW_MS && t < click.t).length,
    );
    const medianMoves = median(movesBeforeEachClick);
    return {
      id: "pointer-path",
      applicable: true,
      agentLikelihood: rampFromAgentToHuman(medianMoves, TELEPORT_MEDIAN_MOVES, HUMAN_MEDIAN_MOVES),
      weight: POINTER_PATH_WEIGHT,
      group: POINTER_SIGNAL_GROUP,
      reasons: [`median ${medianMoves} pointer moves in the second before each of ${clicks.length} mouse clicks`],
    };
  },
};
