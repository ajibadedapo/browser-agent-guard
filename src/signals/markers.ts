import type { EvidenceEvent, MarkerEvidence, Signal, SignalResult } from "../core/types";
import { KNOWN_MARKERS } from "./markers-list";

export const MARKERS_SIGNAL_ID = "markers";
const MARKER_WEIGHT = 3;

function isKnownMarker(event: EvidenceEvent): event is MarkerEvidence {
  return (
    event.kind === "marker" &&
    KNOWN_MARKERS.some((known) => known.agent === event.agent && known.selector === event.marker)
  );
}

export const markersSignal: Signal = {
  id: MARKERS_SIGNAL_ID,
  evaluate(events): SignalResult {
    const found = events.filter(isKnownMarker);
    const first = found[0];
    if (first === undefined) {
      return { id: MARKERS_SIGNAL_ID, applicable: false, agentLikelihood: 0, weight: MARKER_WEIGHT, reasons: [] };
    }
    const distinctMarkerDescriptions = [...new Set(found.map((marker) => `${marker.agent} marker ${marker.marker}`))];
    return {
      id: MARKERS_SIGNAL_ID,
      applicable: true,
      agentLikelihood: 0.99,
      weight: MARKER_WEIGHT,
      agent: first.agent,
      reasons: distinctMarkerDescriptions.map((description) => `page contains ${description}`),
    };
  },
};
