import { EventLog, readEnvironment, startRecorder, systemClock, type EvidenceEvent } from "../src/index";
import { requireElement, setUpBooking } from "./booking";
import { sessionToFixture, type SessionDetails, type SessionDevice, type SessionFixture, type SessionLabel } from "./session";

const SESSION_EVENT_LIMIT = 20000;
const PREVIEW_DELAY_MS = 250;

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selectedLabel(): SessionLabel {
  return requireElement<HTMLInputElement>("label-agent").checked ? "agent" : "human";
}

function selectedDevice(): SessionDevice {
  const value = requireElement<HTMLSelectElement>("device").value;
  return value === "phone" || value === "tablet" ? value : "desktop";
}

function readDetails(idSuffix: string): SessionDetails {
  return {
    label: selectedLabel(),
    agent: requireElement<HTMLInputElement>("agent-name").value,
    device: selectedDevice(),
    notes: requireElement<HTMLTextAreaElement>("session-notes").value,
    idSuffix,
  };
}

function downloadFixture(fixture: SessionFixture): void {
  const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fixture.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function start(): void {
  setUpBooking();
  const log = new EventLog(SESSION_EVENT_LIMIT);
  const stopRecorder = startRecorder({ log, clock: systemClock, root: document });
  const idSuffix = randomSuffix();
  const finishButton = requireElement<HTMLButtonElement>("finish");
  const status = requireElement("recording-status");
  const details = requireElement<HTMLFieldSetElement>("session-details");
  const agentName = requireElement<HTMLInputElement>("agent-name");
  const preview = requireElement("preview");
  const consent = requireElement<HTMLInputElement>("consent");
  const download = requireElement<HTMLButtonElement>("download");
  const downloadHint = requireElement("download-hint");
  let recorded: { events: EvidenceEvent[]; env: ReturnType<typeof readEnvironment> } | null = null;

  const currentFixture = (): SessionFixture | null =>
    recorded === null ? null : sessionToFixture(recorded.events, recorded.env, readDetails(idSuffix));

  const refresh = (): void => {
    const fixture = currentFixture();
    const needsAgentName = selectedLabel() === "agent";
    agentName.disabled = !needsAgentName;
    agentName.required = needsAgentName;
    preview.textContent = fixture === null ? "" : JSON.stringify(fixture, null, 2);
    const missingAgentName = needsAgentName && fixture?.agent === undefined;
    download.disabled = fixture === null || !consent.checked || missingAgentName;
    downloadHint.textContent = missingAgentName
      ? "Enter the agent name to continue."
      : consent.checked
        ? ""
        : "Tick the consent box to enable the download.";
  };

  finishButton.addEventListener("click", () => {
    stopRecorder();
    recorded = { events: log.all(), env: readEnvironment(window) };
    finishButton.disabled = true;
    status.textContent = `Recording stopped. ${recorded.events.length} events captured.`;
    details.disabled = false;
    refresh();
    requireElement("review-heading").focus();
  });

  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshSoon = (): void => {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(() => {
      previewTimer = null;
      refresh();
    }, PREVIEW_DELAY_MS);
  };

  details.addEventListener("input", refreshSoon);
  details.addEventListener("change", refresh);
  download.addEventListener("click", () => {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
      refresh();
    }
    const fixture = currentFixture();
    if (fixture !== null && !download.disabled) {
      downloadFixture(fixture);
    }
  });
  refresh();
}

start();
