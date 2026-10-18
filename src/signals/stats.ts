export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

export function formatMs(value: number): string {
  return `${Number(value.toFixed(1))} ms`;
}

const AGENT_LIKE = 0.9;
const HUMAN_LIKE = 0.1;

export function rampFromAgentToHuman(value: number, agentAtOrBelow: number, humanAtOrAbove: number): number {
  if (value <= agentAtOrBelow) {
    return AGENT_LIKE;
  }
  if (value >= humanAtOrAbove) {
    return HUMAN_LIKE;
  }
  const progress = (value - agentAtOrBelow) / (humanAtOrAbove - agentAtOrBelow);
  return AGENT_LIKE - progress * (AGENT_LIKE - HUMAN_LIKE);
}
