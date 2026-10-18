import { defaultSignals } from "../signals";
import { MARKERS_SIGNAL_ID } from "../signals/markers";
import type { Environment, EvidenceEvent, Signal, SignalResult, Verdict } from "./types";

export type ScoreOptions = { agentThreshold?: number; humanThreshold?: number; mode?: "detect" | "block" };

const DEFAULT_AGENT_THRESHOLD = 0.8;
const DEFAULT_HUMAN_THRESHOLD = 0.35;
const MINIMUM_AGREEING_BEHAVIOURAL_SIGNALS = 2;
const UNSURE_WITH_EVIDENCE_CONFIDENCE = 0.25;

function totalWeight(results: SignalResult[]): number {
  return results.reduce((sum, result) => sum + result.weight, 0);
}

function weightedMean(results: SignalResult[]): number {
  const weight = totalWeight(results);
  if (weight <= 0) {
    return 0;
  }
  return results.reduce((sum, result) => sum + result.agentLikelihood * result.weight, 0) / weight;
}

function isMarker(result: SignalResult): boolean {
  return result.id === MARKERS_SIGNAL_ID;
}

function independenceGroup(result: SignalResult): string {
  return result.group === undefined ? `signal:${result.id}` : `group:${result.group}`;
}

export function score(results: SignalResult[], options: ScoreOptions = {}): Verdict {
  const agentThreshold = options.agentThreshold ?? DEFAULT_AGENT_THRESHOLD;
  const humanThreshold = options.humanThreshold ?? DEFAULT_HUMAN_THRESHOLD;
  const applicable = results.filter((result) => result.applicable);
  if (totalWeight(applicable) <= 0) {
    return { kind: "unsure", confidence: 0, reasons: [] };
  }

  const reasons = applicable.flatMap((result) => result.reasons);
  const agreeing = applicable.filter((result) => result.agentLikelihood >= agentThreshold);
  const marker = applicable.find(isMarker);
  if (marker !== undefined) {
    const behaviourOnly = (): Verdict =>
      score(
        applicable.filter((result) => !isMarker(result)),
        { agentThreshold, humanThreshold },
      );
    if (options.mode === "block" && behaviourOnly().kind === "human") {
      return { kind: "unsure", confidence: UNSURE_WITH_EVIDENCE_CONFIDENCE, reasons };
    }
    return {
      kind: "agent",
      confidence: weightedMean([marker, ...agreeing.filter((result) => !isMarker(result))]),
      ...(marker.agent === undefined ? {} : { agent: marker.agent }),
      reasons,
    };
  }

  const behavioural = applicable.filter((result) => !isMarker(result));
  const agreeingBehaviouralGroups = new Set(
    behavioural.filter((result) => result.agentLikelihood >= agentThreshold).map(independenceGroup),
  );
  const mean = weightedMean(applicable);
  if (agreeingBehaviouralGroups.size >= MINIMUM_AGREEING_BEHAVIOURAL_SIGNALS && mean >= agentThreshold) {
    return { kind: "agent", confidence: weightedMean(agreeing), reasons };
  }

  if (behavioural.length > 0 && mean <= humanThreshold) {
    return { kind: "human", confidence: 1 - mean, reasons };
  }

  return { kind: "unsure", confidence: UNSURE_WITH_EVIDENCE_CONFIDENCE, reasons };
}

export function evaluate(
  events: EvidenceEvent[],
  env: Environment,
  signals: Signal[] = defaultSignals,
  options: ScoreOptions = {},
): Verdict {
  return score(
    signals.map((signal) => signal.evaluate(events, env)),
    options,
  );
}
