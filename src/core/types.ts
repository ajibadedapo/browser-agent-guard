export type PointerKind = "mouse" | "touch" | "pen" | "keyboard";

export type FieldKind = "credential" | "text" | "select" | "checkbox" | "other";

export type ElementRect = { x: number; y: number; w: number; h: number };

export type MoveEvidence = {
  kind: "move";
  t: number;
  x: number;
  y: number;
  pointer: PointerKind;
};

export type PressEvidence = {
  kind: "down" | "click";
  t: number;
  x: number;
  y: number;
  pointer: PointerKind;
  trusted: boolean;
  rect: ElementRect;
};

export type KeyEvidence = {
  kind: "key";
  t: number;
  trusted: boolean;
  printable: boolean;
  modifier: "meta" | "ctrl" | null;
};

export type InputEvidence = {
  kind: "input";
  t: number;
  trusted: boolean;
  inputType: string | null;
  length: number | null;
  field: FieldKind;
};

export type PasteEvidence = {
  kind: "paste";
  t: number;
  trusted: boolean;
  field: FieldKind;
};

export type ChangeEvidence = {
  kind: "change";
  t: number;
  trusted: boolean;
  field: FieldKind;
};

export type ScrollEvidence = {
  kind: "scroll";
  t: number;
  trusted: boolean;
};

export type MarkerEvidence = {
  kind: "marker";
  t: number;
  agent: string;
  marker: string;
};

export type EvidenceEvent =
  | MoveEvidence
  | PressEvidence
  | KeyEvidence
  | InputEvidence
  | PasteEvidence
  | ChangeEvidence
  | ScrollEvidence
  | MarkerEvidence;

export type Environment = { webdriver: boolean; automationTraces: string[] };

export type SignalResult = {
  id: string;
  applicable: boolean;
  agentLikelihood: number;
  weight: number;
  group?: string;
  agent?: string;
  reasons: string[];
};

export interface Signal {
  id: string;
  evaluate(events: EvidenceEvent[], env: Environment): SignalResult;
}

export type Verdict = {
  kind: "human" | "agent" | "unsure";
  confidence: number;
  agent?: string;
  reasons: string[];
};
