import type { Clock } from "../core/clock";
import { evaluate } from "../core/scorer";
import { parseSummary } from "../core/summary";
import type { Signal, Verdict } from "../core/types";
import { defaultSignals } from "../signals";
import { assertSecret, readToken, type TokenStore, wallClock } from "./tokens";

export type VerifyReason =
  | "ok"
  | "agent"
  | "missing"
  | "bad-summary"
  | "bad-token"
  | "expired"
  | "replayed"
  | "allowed-agent";

export type VerifySubmissionInput = {
  summary: string | null;
  secret: string;
  store: TokenStore;
  mode: "detect" | "block";
  missing?: "block" | "allow";
  clock?: Clock;
  signals?: Signal[];
  verifiedAgent?: string | null;
  allow?: string[];
};

export type VerifySubmissionResult = { allowed: boolean; verdict: Verdict; reason: VerifyReason };

const noEvidenceVerdict: Verdict = { kind: "unsure", confidence: 0, reasons: [] };

async function checkToken(
  token: string,
  secret: string,
  store: TokenStore,
  now: number,
): Promise<"bad-token" | "expired" | "replayed" | null> {
  const claims = await readToken(token, secret);
  if (claims === null) {
    return "bad-token";
  }
  if (claims.expiresAt <= now) {
    return "expired";
  }
  return (await store.consume(claims.id, claims.expiresAt)) ? null : "replayed";
}

export async function verifySubmission(input: VerifySubmissionInput): Promise<VerifySubmissionResult> {
  assertSecret(input.secret);
  const clock = input.clock ?? wallClock;
  const blocking = input.mode === "block";
  const verifiedAgent = input.verifiedAgent ?? null;

  if (verifiedAgent !== null && (input.allow ?? []).includes(verifiedAgent)) {
    return {
      allowed: true,
      verdict: { kind: "agent", confidence: 1, agent: verifiedAgent, reasons: ["verified-agent"] },
      reason: "allowed-agent",
    };
  }

  const allowMissing = (input.missing ?? "block") === "allow";
  if (input.summary === null || input.summary === "") {
    return { allowed: !blocking || allowMissing, verdict: noEvidenceVerdict, reason: "missing" };
  }

  const parsed = parseSummary(input.summary);
  if (parsed === null) {
    return { allowed: !blocking, verdict: noEvidenceVerdict, reason: "bad-summary" };
  }
  if (parsed.token === null) {
    return { allowed: !blocking || allowMissing, verdict: noEvidenceVerdict, reason: "missing" };
  }

  const tokenProblem = await checkToken(parsed.token, input.secret, input.store, clock());
  const verdict = evaluate(parsed.events, parsed.env, input.signals ?? defaultSignals, { mode: input.mode });
  if (tokenProblem !== null) {
    return { allowed: !blocking, verdict, reason: tokenProblem };
  }
  if (verdict.kind === "agent") {
    return { allowed: !blocking, verdict, reason: "agent" };
  }
  return { allowed: true, verdict, reason: "ok" };
}
