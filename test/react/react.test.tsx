import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guard, GuardCheck, GuardOptions } from "../../src/browser/guard";
import type { Verdict } from "../../src/core/types";

type FakeGuard = Guard & { emit(verdict: Verdict): void; destroyed: boolean };

const created: { options: GuardOptions; guard: FakeGuard }[] = [];

function fakeGuard(): FakeGuard {
  const listeners = new Set<(verdict: Verdict) => void>();
  let current: Verdict = { kind: "unsure", confidence: 0, reasons: [] };
  const guard: FakeGuard = {
    destroyed: false,
    verdict: () => current,
    check: async (): Promise<GuardCheck> => ({ verdict: current, summary: "fake-summary" }),
    on(_event, callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy() {
      guard.destroyed = true;
      listeners.clear();
    },
    emit(verdict) {
      current = verdict;
      listeners.forEach((listener) => listener(verdict));
    },
  };
  return guard;
}

vi.mock("../../src/browser/guard", () => ({
  createGuard: vi.fn((options: GuardOptions) => {
    const guard = fakeGuard();
    created.push({ options, guard });
    return guard;
  }),
}));

const { GuardProvider, useAgentGuard } = await import("../../src/react/index");

type Seen = ReturnType<typeof useAgentGuard>;

function Probe({ onRender }: { onRender: (value: Seen) => void }): ReactNode {
  const value = useAgentGuard();
  onRender(value);
  return <span>{value.verdict.kind}</span>;
}

const agentVerdict: Verdict = { kind: "agent", agent: "claude", confidence: 0.95, reasons: ["marker"] };

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  created.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  container.remove();
  vi.unstubAllGlobals();
});

function mount(node: ReactNode): void {
  root = createRoot(container);
  act(() => root?.render(node));
}

describe("React helpers", () => {
  it("renders on the server without throwing", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);

    const html = renderToString(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={() => {}} />
      </GuardProvider>,
    );

    expect(html).toContain("unsure");
    expect(created).toHaveLength(0);
  });

  it("useAgentGuard starts unsure", () => {
    const seen: Seen[] = [];

    mount(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={(value) => seen.push(value)} />
      </GuardProvider>,
    );

    expect(seen[0]?.verdict.kind).toBe("unsure");
    expect(container.textContent).toBe("unsure");
    expect(created).toHaveLength(1);
    expect(created[0]?.options).toEqual({ mode: "detect" });
  });

  it("verdict updates when the guard emits", () => {
    mount(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={() => {}} />
      </GuardProvider>,
    );

    act(() => created[0]?.guard.emit(agentVerdict));

    expect(container.textContent).toBe("agent");
  });

  it("check delegates to the guard", async () => {
    let latest: Seen | null = null;
    mount(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={(value) => (latest = value)} />
      </GuardProvider>,
    );

    const result = await (latest as Seen | null)?.check();

    expect(result).toEqual({ verdict: { kind: "unsure", confidence: 0, reasons: [] }, summary: "fake-summary" });
  });

  it("destroys the guard on unmount", () => {
    mount(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={() => {}} />
      </GuardProvider>,
    );

    act(() => root?.unmount());
    root = null;

    expect(created[0]?.guard.destroyed).toBe(true);
  });

  it("does not recreate the guard when options change identity on rerender", () => {
    mount(
      <GuardProvider options={{ mode: "detect" }}>
        <Probe onRender={() => {}} />
      </GuardProvider>,
    );

    act(() =>
      root?.render(
        <GuardProvider options={{ mode: "block" }}>
          <Probe onRender={() => {}} />
        </GuardProvider>,
      ),
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.guard.destroyed).toBe(false);
  });

  it("useAgentGuard outside a provider throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => mount(<Probe onRender={() => {}} />)).toThrow("useAgentGuard must be used inside a GuardProvider");
  });
});
