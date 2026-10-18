import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Environment, EvidenceEvent } from "../src/core/types";

export type Fixture = {
  id: string;
  label: "human" | "agent";
  agent?: string;
  device: "desktop" | "phone" | "tablet";
  notes: string;
  consent: "author" | "volunteer";
  env: Environment;
  events: EvidenceEvent[];
};

const sessionsDirectory = fileURLToPath(new URL("../fixtures/sessions/", import.meta.url));

export function loadFixtures(): Fixture[] {
  return readdirSync(sessionsDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(sessionsDirectory, name), "utf8")) as Fixture);
}

export function fixtureNamed(id: string): Fixture {
  const fixture = loadFixtures().find((candidate) => candidate.id === id);
  if (fixture === undefined) {
    throw new Error(`missing fixture ${id}`);
  }
  return fixture;
}
