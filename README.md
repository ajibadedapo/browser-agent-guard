# browser-agent-guard

Detect or block AI agents that drive a browser on your site, like Claude in Chrome and ChatGPT's agent. Open source and runs on your page. No data leaves your site: the evidence summary is only added to forms that post to your own origin, and the only requests it makes go to endpoints you configure.

- Live demo: https://ajibadedapo.github.io/browser-agent-guard/
- Contribute a session: https://ajibadedapo.github.io/browser-agent-guard/contribute.html
- MIT licensed. The browser script is under 15 KB gzipped, checked in CI.

## What it detects

Browser agents such as Claude in Chrome, ChatGPT agent, Perplexity Comet, Browser Use and plain Playwright scripts work inside a real browser. Many of them run in a person's own logged-in browser and leave the usual automation flag off. This library watches how the page is used and gives a verdict: `human`, `agent` (named when it can tell which one) or `unsure`, with a confidence and a list of reasons.

It looks at:

1. **Agent markers.** Exact element ids that named agents add to the page. Unknown additions are ignored.
2. **Environment.** `navigator.webdriver` and known automation framework traces.
3. **Synthetic input.** Untrusted `input`, `paste` and `change` events, and text that appears with no key press or paste.
4. **Typing rhythm.** Machine-fast, machine-even gaps between key presses.
5. **Pointer path.** Clicks with almost no pointer movement before them.
6. **Click precision.** Clicks that land on the exact centre of what was clicked.
7. **Session rhythm.** Bursts of rapid actions separated by long idle gaps.

A marker alone names the agent. Without a marker, at least two separate signals must agree before the verdict is `agent`. Signals that read the same evidence count once: pointer path and click precision share the clicks, and synthetic input and session rhythm share untrusted input events. See [docs/how-it-works.md](docs/how-it-works.md).

## Quick start: script tag

Add one line to your page:

```html
<script src="https://cdn.jsdelivr.net/npm/browser-agent-guard@0.1/dist/browser/auto.global.js" data-mode="detect"></script>
```

In production, pin an exact version and add `integrity` and `crossorigin="anonymous"` attributes. The script reads these attributes:

| Attribute | Values | Default |
| --- | --- | --- |
| `data-mode` | `detect` or `block` | `detect` |
| `data-action` | `disable` or `message` (block mode only) | `disable` |
| `data-message` | Text shown when `data-action="message"` | A plain sentence saying the action was blocked |
| `data-token-endpoint` | URL of your token endpoint (see [Server check](#server-check)) | none |
| `data-forms` | CSS selector for the forms to protect | every form that posts to your own origin |

The guard is then available as `window.browserAgentGuard`:

```html
<script>
  window.browserAgentGuard.on("verdict", (verdict) => {
    console.log(verdict.kind, verdict.confidence);
  });
</script>
```

The guard only handles forms that submit with `method="post"` to your own origin (the form's `action`, or the submit button's `formaction`, resolves to `location.origin`). If you set `data-forms` or the `forms` option, a form must also match that selector. GET forms, such as search, and forms that post to another origin are never touched, in either mode.

In detect mode nothing visible on the page changes. A handled form gets a hidden `bag_summary` field when it is submitted, which your server can check.

In block mode, a handled form's submit is stopped when the verdict is `agent`, and the form is disabled or a message is shown after it. Before any interaction the verdict is `unsure`, so block mode never blocks at page load.

## npm

```sh
npm install browser-agent-guard
```

The package declares Node 22.18 or later for the server helpers and the build tools. The browser bundle has no Node requirement.

```ts
import { createGuard } from "browser-agent-guard";

const guard = createGuard({
  mode: "block",
  action: "message",
  tokenEndpoint: "/api/agent-guard/token",
});

guard.on("verdict", (verdict) => {
  console.log(verdict.kind, verdict.agent, verdict.confidence);
});
```

`createGuard` options:

| Option | Type | Default |
| --- | --- | --- |
| `mode` | `"detect"` or `"block"` | required |
| `action` | `"disable"`, `"message"` or `(verdict) => void` | `"disable"` |
| `message` | string | `DEFAULT_BLOCK_MESSAGE` |
| `tokenEndpoint` | string | none |
| `tokenTimeoutMs` | number | `3000` |
| `fieldName` | string | `"bag_summary"` |
| `forms` | CSS selector | every form that posts to your own origin |
| `signals` | `Signal[]` | `defaultSignals` |

The guard returns:

- `verdict()`: the current verdict.
- `check(target?)`: fetches a token (if `tokenEndpoint` is set), scores recent activity, and returns `{ verdict, summary }`. If `target` is a handled form or inside one, it writes the summary into the hidden field. In block mode it applies the action to `target` when the verdict is `agent`.
- `on("verdict", callback)`: calls back when the verdict changes. Returns an unsubscribe function.
- `destroy()`: removes every listener.

Call `createGuard` in the browser only. Importing the package on the server is safe.

Use `check()` for actions that are not form submits, such as a button that calls your API:

```ts
button.addEventListener("click", async () => {
  const { verdict, summary } = await guard.check(button);
  if (verdict.kind === "agent") {
    return;
  }
  const body = new FormData();
  body.set("bag_summary", summary);
  await fetch("/api/book", { method: "POST", body });
});
```

## React and Next.js

```tsx
"use client";

import type { ReactNode } from "react";
import { GuardProvider } from "browser-agent-guard/react";

export function AgentGuard({ children }: { children: ReactNode }) {
  return (
    <GuardProvider options={{ mode: "block", action: "message", tokenEndpoint: "/api/agent-guard/token" }}>
      {children}
    </GuardProvider>
  );
}
```

Wrap your layout in `AgentGuard`. `GuardProvider` reads `options` once, when it mounts. Changing the object later has no effect. To change options, remount it with a `key`:

```tsx
<GuardProvider key={mode} options={{ mode }}>
  {children}
</GuardProvider>
```

Read the verdict, or check before an action, with the hook:

```tsx
"use client";

import type { MouseEvent } from "react";
import { useAgentGuard } from "browser-agent-guard/react";

export function BookButton() {
  const { verdict, check } = useAgentGuard();

  async function book(event: MouseEvent<HTMLButtonElement>) {
    const { summary } = await check(event.currentTarget);
    const body = new FormData();
    body.set("bag_summary", summary);
    await fetch("/api/book", { method: "POST", body });
  }

  return (
    <button type="button" onClick={book} data-verdict={verdict.kind}>
      Book
    </button>
  );
}
```

`useAgentGuard` must be used inside a `GuardProvider`. `check` rejects if it is called before the provider has mounted.

For normal `<form method="post">` submits to your own origin you do not need the hook. The guard writes the `bag_summary` hidden field before your `onSubmit` handler runs, so `new FormData(event.currentTarget)` already contains it.

## Server check

The browser part can be removed or edited by anyone who controls the browser. The server check is what makes blocking hold. It re-scores the evidence itself and rejects summaries that are missing, forged with a bad token, expired or replayed.

1. Generate a secret of at least 32 bytes, for example with `openssl rand -base64 32`, and keep it on the server.
2. Add a token endpoint and point the guard at it with `tokenEndpoint` or `data-token-endpoint`.
3. Verify the `bag_summary` field on every protected request.

Token endpoint, `app/api/agent-guard/token/route.ts`:

```ts
import { handleTokenRequest } from "browser-agent-guard/server";

export async function POST(request: Request) {
  return handleTokenRequest(request, process.env.AGENT_GUARD_SECRET!);
}
```

A shared token store, `lib/agent-guard.ts`:

```ts
import { memoryTokenStore } from "browser-agent-guard/server";

export const tokenStore = memoryTokenStore();
```

The protected route, `app/api/book/route.ts`:

```ts
import { verifySubmission } from "browser-agent-guard/server";
import { tokenStore } from "@/lib/agent-guard";

export async function POST(request: Request) {
  const form = await request.formData();
  const summary = form.get("bag_summary");

  const result = await verifySubmission({
    summary: typeof summary === "string" ? summary : null,
    secret: process.env.AGENT_GUARD_SECRET!,
    store: tokenStore,
    mode: "block",
  });

  if (!result.allowed) {
    console.warn("agent guard", result.reason, result.verdict.reasons);
    return Response.json({ error: "This request could not be completed." }, { status: 403 });
  }

  return Response.json({ ok: true });
}
```

`result.reason` is one of `ok`, `agent`, `missing`, `bad-summary`, `bad-token`, `expired`, `replayed` or `allowed-agent`. In block mode a missing summary is blocked unless you pass `missing: "allow"`. In detect mode every request is allowed and you get the verdict to log. Log the reasons on the server. Never send them to the client.

Full details, including how to write a shared token store: [docs/server.md](docs/server.md).

### Allow a verified agent

Some agents sign their requests with Web Bot Auth (HTTP message signatures with an Ed25519 key published by the agent operator). You can let a named, verified agent through block mode. Page markers never grant access, since anyone can fake them.

`seenNonce` records each signature nonce once. Add it to `lib/agent-guard.ts` next to `tokenStore`; [docs/server.md](docs/server.md#seennonce) has a Redis version you can copy.

```ts
import { createAgentKeyResolver, verifyAgentRequest, verifySubmission } from "browser-agent-guard/server";
import { seenNonce, tokenStore } from "@/lib/agent-guard";

const trustedAgent = "https://agent.example";
const resolveKey = createAgentKeyResolver({ origins: [trustedAgent] });

export async function POST(request: Request) {
  const identity = await verifyAgentRequest(request, { resolveKey, seenNonce });
  const form = await request.formData();
  const summary = form.get("bag_summary");

  const result = await verifySubmission({
    summary: typeof summary === "string" ? summary : null,
    secret: process.env.AGENT_GUARD_SECRET!,
    store: tokenStore,
    mode: "block",
    verifiedAgent: identity.verified ? identity.agent : null,
    allow: [trustedAgent],
  });

  if (!result.allowed) {
    return Response.json({ error: "This request could not be completed." }, { status: 403 });
  }
  return Response.json({ ok: true });
}
```

Rules that keep this safe:

- List the agent origins you trust in `createAgentKeyResolver({ origins })`. Keys are only fetched from those origins.
- Never pass a request header value to `fetchKeyDirectory`. That would let a caller make your server fetch any URL.
- The request must carry a `Signature-Agent` header covered by the signature. The resolver returns no key without it, so the request is not verified.
- `allow` entries are compared with the exact `Signature-Agent` value.
- `seenNonce` must record and check the nonce in one atomic step, shared across all your servers. See [docs/server.md](docs/server.md#web-bot-auth).

## Benchmark

Recorded sessions from agents and people are replayed through the detector in CI. These tables are copied from [bench/results.md](bench/results.md), which is regenerated by `npm run bench` and is the source of truth.

Targets: at least 95% of sessions detected for each named agent, and no human session flagged as agent (block mode blocks exactly the flagged sessions).

Sample sizes are too small to establish these rates: 1 human session (about 600 clean sessions are needed to support at most 0.5%), 8 agent sessions.

No failures on 9 recordings.

Each row counts distinct recordings. Behaviour only scores each recording again with its page markers removed, as if the vendor renamed or dropped them. The environment check (such as `navigator.webdriver`) still counts.

| Agent | Detected | Behaviour only | Result |
| --- | --- | --- | --- |
| claude-in-chrome | 3 of 3 (100%) | 3 of 3 (100%) | pass (small sample) |
| chatgpt-agent | 2 of 2 (100%) | 2 of 2 (100%) | pass (small sample) |
| comet | not yet tested | not yet tested | not yet tested |
| browser-use | not yet tested | not yet tested | not yet tested |
| playwright | 3 of 3 (100%) | 3 of 3 (100%) | pass (small sample) |

| Group | Flagged as agent | Result |
| --- | --- | --- |
| human desktop | 0 of 1 (0%) | pass (small sample) |
| human phone | not yet tested | not yet tested |
| human tablet | not yet tested | not yet tested |

Be clear about what this shows. The samples are very small. The numbers show the detector works on the sessions we have, not that it reaches these rates in general. More sessions, especially from people on phones, keyboard-only users and screen reader users, make these numbers meaningful. You can [contribute one](https://ajibadedapo.github.io/browser-agent-guard/contribute.html).

## Limits

- **It is a guard, not a firewall.** It raises the cost of using a browser agent on your site. It does not make it impossible.
- **Evidence can be forged.** Someone in full control of their browser can strip the script or send a summary that looks human. The server check, with one-time tokens and its own scoring, raises the cost of doing so. It cannot prove who is at the keyboard.
- **Out of scope:** crawlers, scrapers and agents that call your API without a browser. Use server-side bot tools for those.
- **Not intercepted:** `form.submit()` called from script, which fires no submit event, and forms inside shadow roots. Call `guard.check(form)` before submitting those yourself. GET forms and forms that post to another origin are left alone on purpose, so the evidence never travels to a third party.
- **Markers can be planted, so block mode does not trust them alone.** A marker only counts if its element sits directly under `<html>`, `<head>` or `<body>`, or was added after the guard started. Text a user writes into your page, such as a heading with a marker id inside an article, is ignored. Even so, someone who can add elements to your page could add one. In block mode a marker therefore decides `agent` only when the rest of the evidence is not clearly human: a marker next to clearly human behaviour gives `unsure` and is not blocked. Detect mode still reports the marker and the agent name.
- **A removed and re-attached marker is not counted again.** Each marker element is recorded once. If an agent removes its marker and puts the same element back later, the guard drops it once it is gone and does not record it a second time, so detection falls back to behaviour.
- **Block mode fails closed when scoring throws during a token fetch.** With `tokenEndpoint` set, if the check throws, the submit is dropped in block mode and goes ahead in detect mode. Without a token endpoint, the error shows in the console and the submit goes ahead without a summary; the server check then treats it as `missing`, which block mode rejects by default.
- **The memory token store is per process.** With more than one server process, use a shared store with an atomic set-if-absent and expiry, such as Redis `SET key value NX PX ttl`. See [docs/server.md](docs/server.md#token-store).
- **Rate limit the token endpoint.** It issues a signed token to anyone who asks.
- **Never echo reasons to clients.** Do not send `verdict.reasons` or `result.reason` back in responses. They tell an attacker exactly what to change. Log them on the server.

## Privacy

Everything runs on your page and your server. The library sends nothing to us or to any third party, and has no telemetry. The only network requests it makes are to endpoints you configure: your token endpoint, and, on the server, the key directories of agent origins you allow-list.

What is recorded, kept in memory on the page, and sent to your server in the `bag_summary` field of forms that post to your own origin:

- Pointer positions and times, and the position and size of clicked elements.
- When keys are pressed, whether each was a character key or a shortcut, and whether the event was trusted. Key presses and trusted input events in credential fields are not recorded at all. Untrusted input in a credential field, such as a password manager fill, is recorded with no length and at most once per field per second.
- Field kind (text, select, checkbox, credential, other) and the length of text in non-credential fields.
- Paste, change and scroll events, with their trust flag.
- Known agent markers, `navigator.webdriver`, and automation framework traces.

What is never recorded: which key was pressed, typed characters, field values, pasted content, or any length for password, email and autofill fields. Password and email fields, and fields whose `autocomplete` names an autofill token, count as credential fields.

## Accessibility

People who use a keyboard, a screen reader, voice control, switch access, autofill or a password manager must never be flagged for that. None of these is treated as evidence on its own:

- Clicks made from the keyboard are recorded as keyboard clicks and never feed the pointer and click checks. Touch and pen input do not feed them either.
- Password, email and autofill fields are ignored by the synthetic input check, since password managers fill them.
- Trusted text that appears without a key press, as with autofill or dictation, is neutral.
- Pastes made with a keyboard shortcut count as human.
- Voice control and switch access often click the centre of an element with no pointer movement first. The pointer path and click precision checks read the same clicks, so they count as one signal: pointer evidence alone never produces an `agent` verdict.
- Unknown elements added to the page, such as those from browser extensions, are ignored.
- Without an exact agent marker, no single signal can produce an `agent` verdict. Scripted dropdowns and steppers that send untrusted input events feed both the synthetic input and session rhythm checks, so those two count as one signal.

The benchmark does not yet include keyboard-only, screen reader, voice control or switch access sessions. If you find a case where a person using assistive technology is flagged, please open an issue or [contribute a session](https://ajibadedapo.github.io/browser-agent-guard/contribute.html).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Licence

MIT
