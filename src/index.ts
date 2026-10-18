export type {
  ChangeEvidence,
  ElementRect,
  Environment,
  EvidenceEvent,
  FieldKind,
  InputEvidence,
  KeyEvidence,
  MarkerEvidence,
  MoveEvidence,
  PasteEvidence,
  PointerKind,
  PressEvidence,
  ScrollEvidence,
  Signal,
  SignalResult,
  Verdict,
} from "./core/types";
export type { Clock } from "./core/clock";
export { systemClock } from "./core/clock";
export { EventLog } from "./core/log";
export type { ScoreOptions } from "./core/scorer";
export { evaluate, score } from "./core/scorer";
export { defaultSignals } from "./signals";
export type { ParsedSummary } from "./core/summary";
export { buildSummary, parseSummary, SUMMARY_EVENT_LIMIT } from "./core/summary";
export type { RecorderOptions } from "./browser/recorder";
export { classifyField, readEnvironment, startRecorder } from "./browser/recorder";
export type { Guard, GuardAction, GuardCheck, GuardOptions } from "./browser/guard";
export { createGuard, DEFAULT_BLOCK_MESSAGE, DEFAULT_FIELD_NAME, DEFAULT_TOKEN_TIMEOUT_MS } from "./browser/guard";
