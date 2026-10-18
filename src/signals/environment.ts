import type { Signal, SignalResult } from "../core/types";

const ENVIRONMENT_WEIGHT = 2;

export const environmentSignal: Signal = {
  id: "environment",
  evaluate(_events, env): SignalResult {
    const reasons = [
      ...(env.webdriver ? ["navigator.webdriver is true"] : []),
      ...env.automationTraces.map((trace) => `automation trace ${trace}`),
    ];
    if (reasons.length === 0) {
      return { id: "environment", applicable: false, agentLikelihood: 0, weight: ENVIRONMENT_WEIGHT, reasons: [] };
    }
    return { id: "environment", applicable: true, agentLikelihood: 0.95, weight: ENVIRONMENT_WEIGHT, reasons };
  },
};
