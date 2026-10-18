import { createGuard, type Verdict } from "../src/index";
import { requireElement, setUpBooking } from "./booking";

type DemoMode = "detect" | "block";

function modeFromLocation(search: string): DemoMode {
  return new URLSearchParams(search).get("mode") === "block" ? "block" : "detect";
}

function describeVerdict(verdict: Verdict): string {
  const confidence = `${Math.round(verdict.confidence * 100)}% confidence`;
  const agent = verdict.agent === undefined ? "" : `, agent: ${verdict.agent}`;
  return `Verdict: ${verdict.kind}, ${confidence}${agent}`;
}

function renderVerdict(verdict: Verdict): void {
  requireElement("verdict-summary").textContent = describeVerdict(verdict);
  const reasons = requireElement("verdict-reasons");
  reasons.replaceChildren(
    ...verdict.reasons.map((reason) => {
      const entry = document.createElement("li");
      entry.textContent = reason;
      return entry;
    }),
  );
  requireElement("verdict-no-reasons").hidden = verdict.reasons.length > 0;
}

function markCurrentMode(mode: DemoMode): void {
  for (const candidate of ["detect", "block"] as const) {
    const link = requireElement(`mode-${candidate}`);
    if (candidate === mode) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
  requireElement("mode-description").textContent =
    mode === "block"
      ? "Block mode: if the verdict is agent when you press Book, the booking is stopped and a message appears."
      : "Detect mode: the page only reports the verdict and never changes what you can do.";
}

function start(): void {
  const mode = modeFromLocation(window.location.search);
  markCurrentMode(mode);
  setUpBooking();
  const guard = createGuard({ mode, action: "message" });
  renderVerdict(guard.verdict());
  guard.on("verdict", renderVerdict);
}

start();
