import { describe, expect, it } from "vitest";
import { isMarkerStrippedCopy, NAMED_AGENTS, renderResults, runBenchmark } from "../bench/benchmark";
import { fixtureNamed, loadFixtures, type Fixture } from "./fixtures";

function humanCopy(id: string, withMarker: boolean): Fixture {
  const human = fixtureNamed("human-desktop-001");
  const marker = { kind: "marker" as const, t: 1000.5, agent: "claude-in-chrome", marker: "#claude-agent-glow-border" };
  const events = withMarker ? [marker, ...human.events.filter((event) => event.t > 1000.5)] : human.events;
  return { ...human, id, events };
}

function agentCopy(id: string): Fixture {
  return { ...fixtureNamed("claude-in-chrome-001"), id };
}

function rowNamed(fixtures: Fixture[], group: string) {
  return runBenchmark(fixtures).rows.find((row) => row.group === group);
}

describe("runBenchmark", () => {
  it("groups distinct recordings by agent and device, without the marker-stripped copies", () => {
    const fixtures = loadFixtures();
    for (const agent of ["claude-in-chrome", "chatgpt-agent"]) {
      const recordings = fixtures.filter((fixture) => fixture.agent === agent && !fixture.id.includes("nomarkers"));
      expect(recordings.length).toBeGreaterThanOrEqual(2);
      expect(rowNamed(fixtures, agent)).toMatchObject({ kind: "agent", sessions: recordings.length });
    }
    const humans = fixtures.filter((fixture) => fixture.label === "human" && fixture.device === "desktop");
    expect(humans.length).toBeGreaterThanOrEqual(1);
    expect(rowNamed(fixtures, "human desktop")).toMatchObject({ kind: "human", sessions: humans.length, detected: 0 });
    expect(runBenchmark(fixtures).recordings).toBe(fixtures.filter((fixture) => !isMarkerStrippedCopy(fixture)).length);
  });

  it("does not count a marker-stripped copy as a session", () => {
    const row = rowNamed([fixtureNamed("claude-in-chrome-001"), fixtureNamed("claude-in-chrome-nomarkers-001")], "claude-in-chrome");
    expect(row).toMatchObject({ sessions: 1, detected: 1 });
  });

  it("scores behaviour only on each recording with its markers removed", () => {
    const markedHuman: Fixture = { ...humanCopy("marked-human", true), label: "agent", agent: "claude-in-chrome" };
    const row = rowNamed([markedHuman, agentCopy("agent-a")], "claude-in-chrome");
    expect(row).toMatchObject({ sessions: 2, detected: 2, behaviourOnlyDetected: 1 });
  });

  it("untested agents are listed", () => {
    const result = runBenchmark(loadFixtures());
    const groups = result.rows.map((row) => row.group);
    for (const agent of NAMED_AGENTS) {
      expect(groups).toContain(agent);
    }
    expect(result.rows.find((row) => row.group === "comet")).toMatchObject({ sessions: 0, tested: false });
    expect(renderResults(result)).toMatch(/\| comet \| not yet tested \|/);
  });

  it("untested agents do not fail the benchmark", () => {
    expect(runBenchmark([agentCopy("agent-a"), humanCopy("human-a", false)]).passes).toBe(true);
  });

  it("fails when any human session is flagged as agent", () => {
    const humans = Array.from({ length: 198 }, (_, index) => humanCopy(`human-${index}`, false));
    const result = runBenchmark([agentCopy("agent-a"), ...humans, humanCopy("human-flagged", true)]);
    expect(result.rows.find((row) => row.group === "human desktop")).toMatchObject({ sessions: 199, flagged: 1 });
    expect(result.passes).toBe(false);
    expect(renderResults(result)).toContain("Targets not met on 200 recordings.");
  });

  it("fails without at least one human and one agent session", () => {
    expect(runBenchmark([humanCopy("human-a", false)]).passes).toBe(false);
    expect(runBenchmark([agentCopy("agent-a")]).passes).toBe(false);
    expect(runBenchmark([]).passes).toBe(false);
  });

  it("labels a pass on fewer than 20 sessions per group as a small sample", () => {
    const fixtures = [agentCopy("agent-a"), humanCopy("human-a", false)];
    const markdown = renderResults(runBenchmark(fixtures));
    expect(markdown).toContain("No failures on 2 recordings.");
    expect(markdown).not.toContain("Overall");
    expect(markdown).toContain("| claude-in-chrome | 1 of 1 (100%) | 1 of 1 (100%) | pass (small sample) |");
    expect(markdown).toContain("| human desktop | 0 of 1 (0%) | pass (small sample) |");
    expect(markdown).toContain("Sample sizes are too small to establish these rates: 1 human session (about 600 clean sessions are needed to support at most 0.5%), 1 agent session.");
  });

  it("reports a plain pass once every tested group has at least 20 sessions", () => {
    const fixtures = Array.from({ length: 20 }, (_, index) => [agentCopy(`agent-${index}`), humanCopy(`human-${index}`, false)]).flat();
    const markdown = renderResults(runBenchmark(fixtures));
    expect(markdown).toContain("No failures on 40 recordings.\n");
    expect(markdown).toContain("| claude-in-chrome | 20 of 20 (100%) | 20 of 20 (100%) | pass |");
  });

  it("fails when an agent is detected in fewer than 95% of its sessions", () => {
    const missed: Fixture = { ...humanCopy("missed", false), label: "agent", agent: "browser-use" };
    const result = runBenchmark([missed, humanCopy("human-a", false)]);
    expect(result.rows.find((row) => row.group === "browser-use")).toMatchObject({ sessions: 1, detected: 0 });
    expect(result.passes).toBe(false);
  });
});
