import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.browserAgentGuard?.destroy();
  delete window.browserAgentGuard;
  vi.resetModules();
});

describe("auto script", () => {
  it("exposes a detect mode guard on window when loaded without a script tag", async () => {
    await import("../../src/browser/auto");

    expect(window.browserAgentGuard?.verdict()).toEqual({ kind: "unsure", confidence: 0, reasons: [] });
  });

  it("installs only once", async () => {
    const { installFromScript } = await import("../../src/browser/auto");
    const firstGuard = window.browserAgentGuard;

    expect(installFromScript(document.createElement("script"))).toBe(firstGuard);
  });

  it("reads options from the script data attributes", async () => {
    const { optionsFromScript } = await import("../../src/browser/auto");
    const script = document.createElement("script");
    script.setAttribute("data-mode", "block");
    script.setAttribute("data-action", "message");
    script.setAttribute("data-message", "No agents.");
    script.setAttribute("data-token-endpoint", "/agent-guard/token");
    script.setAttribute("data-forms", "form.checkout");

    expect(optionsFromScript(script)).toEqual({
      mode: "block",
      action: "message",
      message: "No agents.",
      tokenEndpoint: "/agent-guard/token",
      forms: "form.checkout",
    });
  });

  it("falls back to detect mode for unknown values", async () => {
    const { optionsFromScript } = await import("../../src/browser/auto");
    const script = document.createElement("script");
    script.setAttribute("data-mode", "blocking");
    script.setAttribute("data-action", "explode");

    expect(optionsFromScript(script)).toEqual({ mode: "detect" });
  });
});
