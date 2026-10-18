import { describe, expect, it } from "vitest";

describe("server rendering", () => {
  it("importing the core entry without window does not throw", async () => {
    expect(typeof globalThis.window).toBe("undefined");

    const entry = await import("../../src/index");

    expect(typeof entry.createGuard).toBe("function");
    expect(typeof entry.parseSummary).toBe("function");
  });
});
