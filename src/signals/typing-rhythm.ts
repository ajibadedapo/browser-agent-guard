import type { EvidenceEvent, KeyEvidence, Signal, SignalResult } from "../core/types";
import { formatMs, mean, standardDeviation } from "./stats";

const TYPING_WEIGHT = 1;
const MINIMUM_PRINTABLE_KEYS = 8;
const MACHINE_MEAN_INTERVAL_MS = 25;
const MACHINE_INTERVAL_DEVIATION_MS = 30;
const RUN_BREAK_MS = 1000;

function isTypedCharacter(event: EvidenceEvent): event is KeyEvidence {
  return event.kind === "key" && event.printable && event.modifier === null;
}

export const typingRhythmSignal: Signal = {
  id: "typing-rhythm",
  evaluate(events): SignalResult {
    const times = events.filter(isTypedCharacter).map((key) => key.t);
    if (times.length < MINIMUM_PRINTABLE_KEYS) {
      return {
        id: "typing-rhythm",
        applicable: false,
        agentLikelihood: 0,
        weight: TYPING_WEIGHT,
        reasons: times.length === 0 ? [] : [`only ${times.length} typed characters, too few to judge rhythm`],
      };
    }
    const allIntervals = times.slice(1).map((t, index) => t - (times[index] ?? t));
    const intervals = allIntervals.filter((interval) => interval <= RUN_BREAK_MS);
    const runs = allIntervals.length - intervals.length + 1;
    if (intervals.length < MINIMUM_PRINTABLE_KEYS - 1) {
      return {
        id: "typing-rhythm",
        applicable: false,
        agentLikelihood: 0,
        weight: TYPING_WEIGHT,
        reasons: [`typed ${times.length} characters with pauses over ${formatMs(RUN_BREAK_MS)}, too few consecutive keys to judge rhythm`],
      };
    }
    const averageInterval = mean(intervals);
    const deviation = standardDeviation(intervals);
    const machineLike = averageInterval < MACHINE_MEAN_INTERVAL_MS && deviation < MACHINE_INTERVAL_DEVIATION_MS;
    return {
      id: "typing-rhythm",
      applicable: true,
      agentLikelihood: machineLike ? 0.95 : 0.1,
      weight: TYPING_WEIGHT,
      reasons: [
        `typed ${times.length} characters in ${runs} run${runs === 1 ? "" : "s"}, mean ${formatMs(averageInterval)} apart within runs (standard deviation ${formatMs(deviation)})`,
      ],
    };
  },
};
