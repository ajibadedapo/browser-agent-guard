import { describe, expect, it } from "vitest";
import { environmentSignal } from "../../src/signals/environment";

describe("environmentSignal", () => {
  it("webdriver true is agent evidence", () => {
    const result = environmentSignal.evaluate([], { webdriver: true, automationTraces: [] });
    expect(result.id).toBe("environment");
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBe(0.95);
    expect(result.weight).toBe(2);
    expect(result.reasons.join(" ")).toContain("webdriver");
  });

  it("automation traces are agent evidence", () => {
    const result = environmentSignal.evaluate([], { webdriver: false, automationTraces: ["cdc_adoQpoasnfa76pfcZLmcfl"] });
    expect(result.applicable).toBe(true);
    expect(result.agentLikelihood).toBe(0.95);
    expect(result.reasons.join(" ")).toContain("cdc_adoQpoasnfa76pfcZLmcfl");
  });

  it("clean environment is not applicable", () => {
    const result = environmentSignal.evaluate([], { webdriver: false, automationTraces: [] });
    expect(result.applicable).toBe(false);
  });
});
