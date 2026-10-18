import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/core/log";
import type { EvidenceEvent } from "../../src/core/types";

function scrollAt(t: number): EvidenceEvent {
  return { kind: "scroll", t, trusted: true };
}

describe("EventLog", () => {
  it("keeps events in order", () => {
    const log = new EventLog();
    log.push(scrollAt(1000.5));
    log.push({ kind: "move", t: 1010.5, x: 4, y: 8, pointer: "mouse" });
    log.push(scrollAt(1020.5));
    expect(log.all().map((event) => event.t)).toEqual([1000.5, 1010.5, 1020.5]);
    expect(log.size()).toBe(3);
  });

  it("drops oldest beyond limit", () => {
    const log = new EventLog(3);
    for (const t of [1000.5, 2000.5, 3000.5, 4000.5, 5000.5]) {
      log.push(scrollAt(t));
    }
    expect(log.all().map((event) => event.t)).toEqual([3000.5, 4000.5, 5000.5]);
    expect(log.size()).toBe(3);
  });

  it("keeps order across many wraps of the ring", () => {
    const log = new EventLog(4);
    const times = Array.from({ length: 11 }, (_, index) => 1000.5 + index);
    for (const t of times) {
      log.push(scrollAt(t));
    }
    expect(log.all().map((event) => event.t)).toEqual(times.slice(-4));
    expect(log.since(1008.5).map((event) => event.t)).toEqual([1008.5, 1009.5, 1010.5]);
    expect(log.size()).toBe(4);
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects a limit of %s", (limit) => {
    expect(() => new EventLog(limit)).toThrow(RangeError);
  });

  it("since returns events at or after t", () => {
    const log = new EventLog();
    for (const t of [1000.5, 2000.5, 3000.5]) {
      log.push(scrollAt(t));
    }
    const recent = log.since(2000.5);
    expect(recent).toHaveLength(2);
    expect(recent.map((event) => event.t)).toEqual([2000.5, 3000.5]);
  });

  it("returns copies that callers cannot use to mutate the log", () => {
    const log = new EventLog();
    log.push(scrollAt(1000.5));
    log.all().push(scrollAt(2000.5));
    expect(log.size()).toBe(1);
  });
});
