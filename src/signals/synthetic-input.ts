import type { EvidenceEvent, FieldKind, InputEvidence, Signal, SignalResult } from "../core/types";

export const SYNTHETIC_SIGNAL_GROUP = "synthetic";
const SYNTHETIC_WEIGHT = 2;
const TEXT_CHANGE_LOOKBACK_MS = 500;
const PASTE_SHORTCUT_LOOKBACK_MS = 1000;
const UNTRUSTED_LIKELIHOOD = 0.95;
const HUMAN_LIKELIHOOD = 0.05;

type FieldEvent = Extract<EvidenceEvent, { field: FieldKind }>;

function isFieldEvent(event: EvidenceEvent): event is FieldEvent {
  return event.kind === "input" || event.kind === "paste" || event.kind === "change";
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function hasEventBetween(events: EvidenceEvent[], from: number, to: number, matches: (event: EvidenceEvent) => boolean) {
  return events.some((event) => event.t >= from && event.t <= to && matches(event));
}

function isExplainedTextChange(events: EvidenceEvent[], input: InputEvidence): boolean {
  return hasEventBetween(
    events,
    input.t - TEXT_CHANGE_LOOKBACK_MS,
    input.t,
    (event) => (event.kind === "key" || event.kind === "paste") && event.trusted,
  );
}

function followsPasteShortcut(events: EvidenceEvent[], paste: FieldEvent): boolean {
  return hasEventBetween(
    events,
    paste.t - PASTE_SHORTCUT_LOOKBACK_MS,
    paste.t,
    (event) => event.kind === "key" && event.trusted && event.modifier !== null,
  );
}

function untrustedReasons(fieldEvents: FieldEvent[], kind: "paste" | "change" | "input"): string[] {
  const counts = new Map<FieldKind, number>();
  for (const event of fieldEvents) {
    if (event.kind === kind && !event.trusted) {
      counts.set(event.field, (counts.get(event.field) ?? 0) + 1);
    }
  }
  return [...counts].map(([field, count]) => `${countLabel(count, `untrusted ${kind}`)} on ${field} fields`);
}

function unexplainedTextReason(changes: InputEvidence[], trusted: boolean): string[] {
  if (changes.length === 0) {
    return [];
  }
  const lengths = changes.flatMap((change) => (change.length === null ? [] : [change.length]));
  const lengthNote = lengths.length === 0 ? "" : ` (${lengths.join(", ")} characters)`;
  const trustNote = trusted ? "trusted " : "untrusted ";
  return [
    `${countLabel(changes.length, `${trustNote}text change`)}${lengthNote} with no key press or paste in the ${TEXT_CHANGE_LOOKBACK_MS} ms before`,
  ];
}

export const syntheticInputSignal: Signal = {
  id: "synthetic-input",
  evaluate(events): SignalResult {
    const allFieldEvents = events.filter(isFieldEvent);
    const fieldEvents = allFieldEvents.filter((event) => event.field !== "credential");
    if (fieldEvents.length === 0) {
      return {
        id: "synthetic-input",
        applicable: false,
        agentLikelihood: 0,
        weight: SYNTHETIC_WEIGHT,
        group: SYNTHETIC_SIGNAL_GROUP,
        reasons:
          allFieldEvents.length === 0 ? [] : ["only credential fields changed, ignored so password managers are not flagged"],
      };
    }

    const unexplainedText = fieldEvents.filter(
      (event): event is InputEvidence =>
        event.kind === "input" && event.field === "text" && !isExplainedTextChange(events, event),
    );
    const unexplainedUntrusted = unexplainedText.filter((input) => !input.trusted);
    const unexplainedTrusted = unexplainedText.filter((input) => input.trusted);
    const reportedAsTextChange = new Set<EvidenceEvent>(unexplainedUntrusted);
    const untrusted = [
      ...untrustedReasons(fieldEvents, "paste"),
      ...unexplainedTextReason(unexplainedUntrusted, false),
      ...untrustedReasons(
        fieldEvents.filter((event) => !reportedAsTextChange.has(event)),
        "input",
      ),
      ...untrustedReasons(fieldEvents, "change"),
    ];
    const trustedUnexplained = unexplainedTextReason(unexplainedTrusted, true);

    if (untrusted.length > 0) {
      return {
        id: "synthetic-input",
        applicable: true,
        agentLikelihood: UNTRUSTED_LIKELIHOOD,
        weight: SYNTHETIC_WEIGHT,
        group: SYNTHETIC_SIGNAL_GROUP,
        reasons: [...untrusted, ...trustedUnexplained],
      };
    }

    if (trustedUnexplained.length > 0) {
      return {
        id: "synthetic-input",
        applicable: false,
        agentLikelihood: 0,
        weight: SYNTHETIC_WEIGHT,
        group: SYNTHETIC_SIGNAL_GROUP,
        reasons: trustedUnexplained.map((reason) => `${reason}, treated as neutral (autofill or dictation)`),
      };
    }

    const shortcutPastes = fieldEvents.filter((event) => event.kind === "paste" && followsPasteShortcut(events, event));
    return {
      id: "synthetic-input",
      applicable: true,
      agentLikelihood: HUMAN_LIKELIHOOD,
      weight: SYNTHETIC_WEIGHT,
      group: SYNTHETIC_SIGNAL_GROUP,
      reasons: [
        `${countLabel(fieldEvents.length, "field event")}, all trusted, with every text change following a key press or paste`,
        ...(shortcutPastes.length === 0 ? [] : [`${countLabel(shortcutPastes.length, "paste")} made with a keyboard shortcut`]),
      ],
    };
  },
};
