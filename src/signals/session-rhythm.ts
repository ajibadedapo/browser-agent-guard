import type { EvidenceEvent, Signal, SignalResult } from "../core/types";
import { clickDecisions } from "./clicks";
import { SYNTHETIC_SIGNAL_GROUP } from "./synthetic-input";

const SESSION_RHYTHM_WEIGHT = 1;
const BURST_ACTIONS = 3;
const BURST_WINDOW_MS = 150;
const IDLE_GAP_MS = 3000;
const MINIMUM_BURSTS = 2;
const BURSTY_LIKELIHOOD = 0.85;

function isNonClickAction(event: EvidenceEvent): boolean {
  if (event.kind === "paste") {
    return true;
  }
  return (event.kind === "key" || event.kind === "input" || event.kind === "change") && !event.trusted;
}

function actionTimes(events: EvidenceEvent[]): number[] {
  return [...events.filter(isNonClickAction), ...clickDecisions(events)].map((event) => event.t).sort((a, b) => a - b);
}

function splitIntoRuns(times: number[]): number[][] {
  const runs: number[][] = [];
  for (const t of times) {
    const current = runs.at(-1);
    const last = current?.at(-1);
    if (current !== undefined && last !== undefined && t - last <= BURST_WINDOW_MS) {
      current.push(t);
    } else {
      runs.push([t]);
    }
  }
  return runs;
}

function containsBurst(run: number[]): boolean {
  return run.some((t, index) => {
    const third = run[index + BURST_ACTIONS - 1];
    return third !== undefined && third - t <= BURST_WINDOW_MS;
  });
}

function countIsolatedBursts(runs: number[][]): number {
  return runs.filter((run, index) => {
    if (!containsBurst(run)) {
      return false;
    }
    const start = run[0] ?? 0;
    const end = run.at(-1) ?? 0;
    const previousEnd = runs[index - 1]?.at(-1);
    const nextStart = runs[index + 1]?.[0];
    const idleBefore = previousEnd !== undefined && start - previousEnd > IDLE_GAP_MS;
    const idleAfter = nextStart !== undefined && nextStart - end > IDLE_GAP_MS;
    return idleBefore || idleAfter;
  }).length;
}

export const sessionRhythmSignal: Signal = {
  id: "session-rhythm",
  evaluate(events): SignalResult {
    const bursts = countIsolatedBursts(splitIntoRuns(actionTimes(events)));
    const description = `${bursts} burst${bursts === 1 ? "" : "s"} of ${BURST_ACTIONS} or more actions within ${BURST_WINDOW_MS} ms separated by idle gaps over ${IDLE_GAP_MS / 1000} s`;
    if (bursts < MINIMUM_BURSTS) {
      return {
        id: "session-rhythm",
        applicable: false,
        agentLikelihood: 0,
        weight: SESSION_RHYTHM_WEIGHT,
        group: SYNTHETIC_SIGNAL_GROUP,
        reasons: bursts === 0 ? [] : [`${description}, fewer than ${MINIMUM_BURSTS} needed`],
      };
    }
    return {
      id: "session-rhythm",
      applicable: true,
      agentLikelihood: BURSTY_LIKELIHOOD,
      weight: SESSION_RHYTHM_WEIGHT,
      group: SYNTHETIC_SIGNAL_GROUP,
      reasons: [description],
    };
  },
};
