import type { Signal } from "../core/types";
import { clickPrecisionSignal } from "./click-precision";
import { environmentSignal } from "./environment";
import { markersSignal } from "./markers";
import { pointerPathSignal } from "./pointer-path";
import { sessionRhythmSignal } from "./session-rhythm";
import { syntheticInputSignal } from "./synthetic-input";
import { typingRhythmSignal } from "./typing-rhythm";

export const defaultSignals: Signal[] = [
  markersSignal,
  environmentSignal,
  syntheticInputSignal,
  typingRhythmSignal,
  pointerPathSignal,
  clickPrecisionSignal,
  sessionRhythmSignal,
];
