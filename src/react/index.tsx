"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createGuard, type Guard, type GuardCheck, type GuardOptions } from "../browser/guard";
import type { Verdict } from "../core/types";

export type AgentGuardValue = {
  verdict: Verdict;
  check: (target?: Element) => Promise<GuardCheck>;
};

export type GuardProviderProps = {
  options: GuardOptions;
  children?: ReactNode;
};

const UNSURE: Verdict = { kind: "unsure", confidence: 0, reasons: [] };

const AgentGuardContext = createContext<AgentGuardValue | null>(null);

export function GuardProvider({ options, children }: GuardProviderProps): ReactNode {
  const initialOptions = useRef(options);
  const guardRef = useRef<Guard | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(UNSURE);

  useEffect(() => {
    const guard = createGuard(initialOptions.current);
    guardRef.current = guard;
    setVerdict(guard.verdict());
    const unsubscribe = guard.on("verdict", setVerdict);
    return () => {
      unsubscribe();
      guard.destroy();
      if (guardRef.current === guard) {
        guardRef.current = null;
      }
    };
  }, []);

  const check = useCallback((target?: Element): Promise<GuardCheck> => {
    const guard = guardRef.current;
    if (guard === null) {
      return Promise.reject(new Error("browser-agent-guard: the guard has not started yet"));
    }
    return guard.check(target);
  }, []);

  const value = useMemo(() => ({ verdict, check }), [verdict, check]);

  return <AgentGuardContext.Provider value={value}>{children}</AgentGuardContext.Provider>;
}

export function useAgentGuard(): AgentGuardValue {
  const value = useContext(AgentGuardContext);
  if (value === null) {
    throw new Error("useAgentGuard must be used inside a GuardProvider");
  }
  return value;
}
