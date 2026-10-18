import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures";

const FORBIDDEN_PROPERTIES = new Set(["key", "code", "value", "data"]);

const KNOWN_MARKER_SELECTORS = [
  "#claude-agent-glow-border",
  "#claude-phantom-cursor",
  "#claude-agent-animation-styles",
  "#codex-agent-overlay-root",
];

function forbiddenPropertiesIn(node: unknown, path: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => forbiddenPropertiesIn(item, `${path}[${index}]`));
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([name, child]) => {
      const here = `${path}.${name}`;
      const own = FORBIDDEN_PROPERTIES.has(name) && typeof child === "string" ? [here] : [];
      return [...own, ...forbiddenPropertiesIn(child, here)];
    });
  }
  return [];
}

describe("benchmark fixtures", () => {
  const fixtures = loadFixtures();

  it("includes the five spike fixtures", () => {
    const ids = fixtures.map((fixture) => fixture.id);
    for (const id of [
      "chatgpt-agent-001",
      "chatgpt-agent-nomarkers-001",
      "claude-in-chrome-001",
      "claude-in-chrome-nomarkers-001",
      "human-desktop-001",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("every fixture is well formed with a unique id", () => {
    const ids = fixtures.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of fixtures) {
      expect(fixture.id).toMatch(/^[a-z0-9-]+$/);
      expect(["human", "agent"]).toContain(fixture.label);
      expect(["desktop", "phone", "tablet"]).toContain(fixture.device);
      expect(["author", "volunteer"]).toContain(fixture.consent);
      expect(typeof fixture.notes).toBe("string");
      expect(typeof fixture.env.webdriver).toBe("boolean");
      expect(Array.isArray(fixture.env.automationTraces)).toBe(true);
      for (const event of fixture.events) {
        expect(["move", "down", "click", "key", "input", "paste", "change", "scroll", "marker"]).toContain(event.kind);
        expect(Number.isFinite(event.t)).toBe(true);
      }
    }
  });

  it("no fixture records typed text", () => {
    for (const fixture of fixtures) {
      for (const event of fixture.events) {
        const textProperties = Object.entries(event).filter(
          ([name, child]) => typeof child === "string" && !["kind", "pointer", "modifier", "inputType", "field", "agent", "marker"].includes(name),
        );
        expect(textProperties, `${fixture.id} at ${event.t}`).toEqual([]);
      }
    }
  });

  it("every fixture parses and has events sorted by t", () => {
    for (const fixture of fixtures) {
      expect(fixture.events.length).toBeGreaterThan(0);
      const times = fixture.events.map((event) => event.t);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it("no fixture contains a field value or key name", () => {
    for (const fixture of fixtures) {
      expect(forbiddenPropertiesIn(fixture, fixture.id)).toEqual([]);
    }
  });

  it("the human select option click without a pointer type is a keyboard click", () => {
    const human = fixtures.find((fixture) => fixture.id === "human-desktop-001");
    const keyboardClicks = human?.events.filter((event) => event.kind === "click" && event.pointer === "keyboard");
    expect(keyboardClicks?.map((event) => event.t)).toEqual([15757]);
  });

  it("agent fixtures name their agent and human fixtures do not", () => {
    for (const fixture of fixtures) {
      if (fixture.label === "agent") {
        expect(fixture.agent).toMatch(/^(claude-in-chrome|chatgpt-agent|playwright)$/);
      } else {
        expect(fixture.agent).toBeUndefined();
      }
    }
  });

  it("marker events appear only in fixtures of agents with page markers that keep them", () => {
    const agentsWithMarkers = new Set(["claude-in-chrome", "chatgpt-agent"]);
    for (const fixture of fixtures) {
      const markers = fixture.events.filter((event) => event.kind === "marker");
      const expectsMarkers =
        fixture.label === "agent" && agentsWithMarkers.has(fixture.agent ?? "") && !fixture.id.includes("nomarkers");
      expect(markers.length > 0).toBe(expectsMarkers);
      for (const marker of markers) {
        expect(marker.agent).toBe(fixture.agent);
        expect(KNOWN_MARKER_SELECTORS).toContain(marker.marker);
      }
    }
  });

  it("nomarkers variants equal their source minus marker events", () => {
    const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const variants = fixtures.filter((fixture) => fixture.id.includes("-nomarkers-"));
    expect(variants.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining(["claude-in-chrome-nomarkers-001", "chatgpt-agent-nomarkers-001"]),
    );
    for (const variant of variants) {
      const source = byId.get(variant.id.replace("-nomarkers-", "-"));
      expect(variant).toBeDefined();
      expect(source).toBeDefined();
      expect(variant?.events).toEqual(source?.events.filter((event) => event.kind !== "marker"));
    }
  });
});
