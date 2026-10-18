# Benchmark fixtures

Each file in `sessions/` is one recorded session in the library's own event format, replayed through the detector in tests and in the benchmark.

## Format

```ts
type Fixture = {
  id: string;
  label: "human" | "agent";
  agent?: string;
  device: "desktop" | "phone" | "tablet";
  notes: string;
  consent: "author" | "volunteer";
  env: Environment;
  events: EvidenceEvent[];
};
```

`Environment` and `EvidenceEvent` are defined in `src/core/types.ts`. Events are sorted by `t` (milliseconds from page load). Load them in tests with `loadFixtures()` from `test/fixtures.ts`.

Fixtures hold only timing, trust flags, lengths and geometry. They never contain typed characters, key or code names, field values or pasted content. A test fails if any string property named `key`, `code`, `value` or `data` appears.

## Sessions

| File | Label | Agent | Source |
| --- | --- | --- | --- |
| `claude-in-chrome-001.json` | agent | claude-in-chrome | 2026-10-18 spike |
| `claude-in-chrome-002.json` | agent | claude-in-chrome | 2026-10-18 demo contribute page: typed into fields, set the time by form input |
| `claude-in-chrome-003.json` | agent | claude-in-chrome | 2026-10-18 demo contribute page: set every field by direct value setting |
| `claude-in-chrome-nomarkers-001.json` to `-003.json` | agent | claude-in-chrome | the sessions above, marker events removed |
| `chatgpt-agent-001.json` | agent | chatgpt-agent | 2026-10-18 spike |
| `chatgpt-agent-002.json` | agent | chatgpt-agent | 2026-10-18 demo contribute page |
| `chatgpt-agent-nomarkers-001.json` and `-002.json` | agent | chatgpt-agent | the sessions above, marker events removed |
| `playwright-001.json` to `-003.json` | agent | playwright | 2026-10-18, `npm run fixtures:playwright` driving installed Google Chrome (headless) on the demo contribute page |
| `human-desktop-001.json` | human | | 2026-10-18 spike |

The `-nomarkers` variants measure behavioural detection alone, as if the vendor renamed or removed its page markers. The benchmark does not count them as extra sessions: it strips markers from each recording itself for its behaviour only column.

## Regenerating the spike fixtures

```sh
npm run fixtures:spike
```

This runs `scripts/convert-spike.ts` (Node 22 type stripping) over `research/spike-2026-10-18/sessions.json`. Known limits of the conversion are written into each fixture's `notes`: the spike kept only the last 400 pointer moves, press rect sizes are estimated from the spike page CSS, and only `pointerdown` and `click` are kept as presses. The converter still records the spike's email field as a `text` field, as the recorder did at the time; the recorder now treats email fields as credential fields. Converting with the new rule changes no verdict, so the spike fixtures were left as recorded.

## Recording the Playwright sessions

```sh
npm run fixtures:playwright
```

This builds the demo, serves `demo/` on localhost, and runs `scripts/record-playwright.ts`, which drives the installed Google Chrome through `playwright-core` (no browser download) with plain `page.click`, `page.fill`, `page.type` and `page.selectOption`. It does the booking task on `contribute.html` three times, labels each session as agent `playwright`, ticks consent, and saves the downloaded files as `playwright-001.json` to `playwright-003.json`. It falls back to a headed browser if headless recording fails.

## Adding a session

Record with explicit consent, convert to the format above, set `consent` to `author` for the maintainer's own sessions or `volunteer` for anyone else, and describe the agent version, device and any gaps in `notes`.
