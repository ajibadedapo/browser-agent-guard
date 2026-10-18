import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

type RecordedFixture = {
  id: string;
  label: "agent";
  agent: string;
  device: "desktop";
  notes: string;
  consent: "author";
  env: unknown;
  events: unknown[];
};

const SESSION_COUNT = 3;
const AGENT_NAME = "playwright";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const demoDirectory = join(repoRoot, "demo");
const outputDirectory = join(repoRoot, "fixtures/sessions");
const playwrightVersion = (
  JSON.parse(readFileSync(join(repoRoot, "node_modules/playwright-core/package.json"), "utf8")) as { version: string }
).version;

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function serveDemo(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = normalize(join(demoDirectory, path === "/" ? "index.html" : path));
    const type = contentTypes[extname(file)];
    if (!file.startsWith(demoDirectory + sep) || type === undefined) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = readFileSync(file);
      response.writeHead(200, { "content-type": type }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function doBookingTask(page: Page): Promise<void> {
  await page.fill("#name", "Ada Lovelace");
  await page.type("#email", "ada@example.com");
  await page.selectOption("#time", "19:00");
  await page.type("#notes", "Window table if possible");
  await page.click("#terms");
  await page.click("#book");
  await page.click("#item-25");
}

async function downloadLabelledSession(page: Page): Promise<RecordedFixture> {
  await page.click("#finish");
  await page.click("#label-agent");
  await page.fill("#agent-name", AGENT_NAME);
  await page.click("#consent");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
  const path = await download.path();
  return JSON.parse(readFileSync(path, "utf8")) as RecordedFixture;
}

function notesFor(headless: boolean): string {
  return [
    `Recorded 2026-10-18 by scripts/record-playwright.ts: playwright-core ${playwrightVersion} driving the installed Google Chrome (${headless ? "headless" : "headed"}) on the demo contribute page served from localhost.`,
    "The script used page.fill, page.type, page.selectOption and page.click to fill the booking form, press Book and open Item 25, then stopped the recording and labelled it.",
    "No person touched the page. The email field is a credential field, so its key presses and trusted input events are not recorded.",
  ].join(" ");
}

function asAuthorFixture(recorded: RecordedFixture, index: number, headless: boolean): RecordedFixture {
  return {
    id: `${AGENT_NAME}-${String(index).padStart(3, "0")}`,
    label: "agent",
    agent: AGENT_NAME,
    device: "desktop",
    notes: notesFor(headless),
    consent: "author",
    env: recorded.env,
    events: recorded.events,
  };
}

async function recordSessions(browser: Browser, origin: string, headless: boolean): Promise<RecordedFixture[]> {
  const fixtures: RecordedFixture[] = [];
  for (let index = 1; index <= SESSION_COUNT; index += 1) {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/contribute.html`);
      await doBookingTask(page);
      const recorded = await downloadLabelledSession(page);
      if (recorded.label !== "agent" || recorded.agent !== AGENT_NAME || recorded.events.length === 0) {
        throw new Error(`session ${index} was not labelled and recorded as expected`);
      }
      fixtures.push(asAuthorFixture(recorded, index, headless));
    } finally {
      await context.close();
    }
  }
  return fixtures;
}

async function recordWith(headless: boolean, origin: string): Promise<RecordedFixture[]> {
  const browser = await chromium.launch({ channel: "chrome", headless });
  try {
    return await recordSessions(browser, origin, headless);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const { server, origin } = await serveDemo();
  try {
    let fixtures: RecordedFixture[];
    try {
      fixtures = await recordWith(true, origin);
    } catch (error) {
      console.warn(`headless recording failed, retrying headed: ${(error as Error).message}`);
      fixtures = await recordWith(false, origin);
    }
    for (const fixture of fixtures) {
      writeFileSync(join(outputDirectory, `${fixture.id}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
      console.log(`${fixture.id}: ${fixture.events.length} events`);
    }
  } finally {
    server.close();
  }
}

await main();
