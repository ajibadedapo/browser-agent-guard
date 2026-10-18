import type { EvidenceEvent } from "./types";

export class EventLog {
  private readonly events: EvidenceEvent[] = [];
  private oldest = 0;
  private readonly limit: number;

  constructor(limit = 2000) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("EventLog limit must be a positive integer");
    }
    this.limit = limit;
  }

  push(event: EvidenceEvent): void {
    if (this.events.length < this.limit) {
      this.events.push(event);
      return;
    }
    this.events[this.oldest] = event;
    this.oldest = (this.oldest + 1) % this.limit;
  }

  all(): EvidenceEvent[] {
    return this.events.slice(this.oldest).concat(this.events.slice(0, this.oldest));
  }

  since(t: number): EvidenceEvent[] {
    return this.all().filter((event) => event.t >= t);
  }

  size(): number {
    return this.events.length;
  }
}
