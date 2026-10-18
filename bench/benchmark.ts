import { evaluate } from "../src/core/scorer";
import type { Verdict } from "../src/core/types";
import type { Fixture } from "../test/fixtures";

export const NAMED_AGENTS = ["claude-in-chrome", "chatgpt-agent", "comet", "browser-use", "playwright"] as const;
const DEVICES = ["desktop", "phone", "tablet"] as const;

export const MINIMUM_AGENT_DETECTION_RATE = 0.95;
export const MINIMUM_SESSIONS_FOR_A_RATE = 20;
const CLEAN_HUMAN_SESSIONS_FOR_HALF_PERCENT = 600;

export type BenchmarkRow = {
  group: string;
  kind: "agent" | "human";
  tested: boolean;
  sessions: number;
  detected: number;
  flagged: number;
  behaviourOnlyDetected: number;
};

export type BenchmarkResult = { rows: BenchmarkRow[]; passes: boolean; recordings: number };

function isFlagged(verdict: Verdict): boolean {
  return verdict.kind === "agent";
}

const MARKER_STRIPPED_COPY = /-nomarkers-/;

export function isMarkerStrippedCopy(fixture: Fixture): boolean {
  return MARKER_STRIPPED_COPY.test(fixture.id);
}

function withoutMarkers(fixture: Fixture): Fixture["events"] {
  return fixture.events.filter((event) => event.kind !== "marker");
}

function emptyRow(group: string, kind: BenchmarkRow["kind"]): BenchmarkRow {
  return {
    group,
    kind,
    tested: false,
    sessions: 0,
    detected: 0,
    flagged: 0,
    behaviourOnlyDetected: 0,
  };
}

function humanGroup(device: Fixture["device"]): string {
  return `human ${device}`;
}

function rowsInDisplayOrder(fixtures: Fixture[]): Map<string, BenchmarkRow> {
  const fixtureAgents = fixtures.flatMap((fixture) => (fixture.label === "agent" && fixture.agent !== undefined ? [fixture.agent] : []));
  const extraAgents = [...new Set(fixtureAgents)].filter((agent) => !(NAMED_AGENTS as readonly string[]).includes(agent)).sort();
  const rows = new Map<string, BenchmarkRow>();
  for (const agent of [...NAMED_AGENTS, ...extraAgents]) {
    rows.set(agent, emptyRow(agent, "agent"));
  }
  for (const device of DEVICES) {
    rows.set(humanGroup(device), emptyRow(humanGroup(device), "human"));
  }
  return rows;
}

function recordAgentSession(row: BenchmarkRow, fixture: Fixture, verdict: Verdict): void {
  row.detected += isFlagged(verdict) ? 1 : 0;
  row.behaviourOnlyDetected += isFlagged(evaluate(withoutMarkers(fixture), fixture.env)) ? 1 : 0;
}

function recordHumanSession(row: BenchmarkRow, verdict: Verdict): void {
  row.flagged += isFlagged(verdict) ? 1 : 0;
}

function rowPasses(row: BenchmarkRow): boolean {
  if (!row.tested) {
    return true;
  }
  return row.kind === "agent" ? row.detected / row.sessions >= MINIMUM_AGENT_DETECTION_RATE : row.flagged === 0;
}

function sessionsOfKind(rows: BenchmarkRow[], kind: BenchmarkRow["kind"]): number {
  return rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.sessions, 0);
}

function isSmallSample(row: BenchmarkRow): boolean {
  return row.tested && row.sessions < MINIMUM_SESSIONS_FOR_A_RATE;
}

export function runBenchmark(fixtures: Fixture[]): BenchmarkResult {
  const recordings = fixtures.filter((fixture) => !isMarkerStrippedCopy(fixture));
  const rows = rowsInDisplayOrder(recordings);
  for (const fixture of recordings) {
    const group = fixture.label === "agent" ? (fixture.agent ?? "unnamed agent") : humanGroup(fixture.device);
    const row = rows.get(group) ?? emptyRow(group, fixture.label);
    rows.set(group, row);
    row.tested = true;
    row.sessions += 1;
    const verdict = evaluate(fixture.events, fixture.env);
    if (fixture.label === "agent") {
      recordAgentSession(row, fixture, verdict);
    } else {
      recordHumanSession(row, verdict);
    }
  }
  const allRows = [...rows.values()];
  const passes =
    sessionsOfKind(allRows, "agent") > 0 && sessionsOfKind(allRows, "human") > 0 && allRows.every(rowPasses);
  return { rows: allRows, passes, recordings: recordings.length };
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function countOfSessions(count: number, description: string): string {
  return `${count} ${description} ${count === 1 ? "session" : "sessions"}`;
}

function percentage(count: number, total: number): string {
  return `${count} of ${total} (${Math.round((count / total) * 1000) / 10}%)`;
}

function rowResult(row: BenchmarkRow): string {
  if (!rowPasses(row)) {
    return "fail";
  }
  return isSmallSample(row) ? "pass (small sample)" : "pass";
}

function overallResult(result: BenchmarkResult): string {
  const recordings = countOf(result.recordings, "recording");
  return result.passes ? `No failures on ${recordings}.` : `Targets not met on ${recordings}.`;
}

function agentLine(row: BenchmarkRow): string {
  if (!row.tested) {
    return `| ${row.group} | not yet tested | not yet tested | not yet tested |`;
  }
  return `| ${row.group} | ${percentage(row.detected, row.sessions)} | ${percentage(row.behaviourOnlyDetected, row.sessions)} | ${rowResult(row)} |`;
}

function humanLine(row: BenchmarkRow): string {
  if (!row.tested) {
    return `| ${row.group} | not yet tested | not yet tested |`;
  }
  return `| ${row.group} | ${percentage(row.flagged, row.sessions)} | ${rowResult(row)} |`;
}

function sampleSizeLines(result: BenchmarkResult): string[] {
  const humanSessions = sessionsOfKind(result.rows, "human");
  if (humanSessions >= CLEAN_HUMAN_SESSIONS_FOR_HALF_PERCENT && !result.rows.some(isSmallSample)) {
    return [];
  }
  return [
    `Sample sizes are too small to establish these rates: ${countOfSessions(humanSessions, "human")} (about ${countOfSessions(CLEAN_HUMAN_SESSIONS_FOR_HALF_PERCENT, "clean")} are needed to support at most 0.5%), ${countOfSessions(sessionsOfKind(result.rows, "agent"), "agent")}.`,
    "",
  ];
}

export function renderResults(result: BenchmarkResult): string {
  const agents = result.rows.filter((row) => row.kind === "agent");
  const humans = result.rows.filter((row) => row.kind === "human");
  return [
    "# Benchmark results",
    "",
    `Generated by \`npm run bench\` from ${countOf(result.recordings, "distinct recording")} in \`fixtures/sessions\`. The \`-nomarkers\` files are marker-stripped copies of other recordings and are not counted again.`,
    "",
    `Targets: at least ${MINIMUM_AGENT_DETECTION_RATE * 100}% of sessions detected for each named agent, and no human session flagged as agent (block mode blocks exactly the flagged sessions).`,
    "",
    ...sampleSizeLines(result),
    overallResult(result),
    "",
    "## Agents",
    "",
    "Behaviour only scores each recording again with its page markers removed, as if the vendor renamed or dropped them. The environment check (such as \`navigator.webdriver\`) still counts.",
    "",
    "| Agent | Detected | Behaviour only | Result |",
    "| --- | --- | --- | --- |",
    ...agents.map(agentLine),
    "",
    "## Humans",
    "",
    "| Group | Flagged as agent | Result |",
    "| --- | --- | --- |",
    ...humans.map(humanLine),
    "",
  ].join("\n");
}
