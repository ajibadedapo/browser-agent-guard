# Contributing

Thanks for helping. The most useful contributions are recorded sessions and new signals. Detection details are public. Evasion guidance is not accepted (see [SECURITY.md](SECURITY.md)).

## Setup

You need Node 22.18 or later.

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
npm run bench
```

- `npm test` runs the Vitest suite, including the benchmark tests.
- `npm run build` builds the package and fails if the browser script is over 15 KB gzipped.
- `npm run bench` replays every session in `fixtures/sessions` and rewrites `bench/results.md`. It fails if a target is missed. CI fails if `bench/results.md` is not committed after a change.
- `npm run demo:build` builds the demo page in `demo/`.

## Rules

- **No code comments.** No inline, block or doc comments. Use clear names instead.
- **No em dash characters** anywhere: code, tests, docs and commit messages.
- **No real clock in tests.** Inject time and use values with non-zero milliseconds, such as `1000.5`.
- **Test behaviour,** not source text.
- **Privacy.** Never record typed characters, key names, field values or pasted content. Only timing, trust flags, lengths and geometry.
- **No network calls** except to endpoints the site configures.
- **Accessibility.** Keyboard use, screen readers, autofill, password managers and browser extensions must never count as evidence on their own.

## Adding a signal

A signal reads one kind of evidence and returns a `SignalResult`. See [docs/how-it-works.md](docs/how-it-works.md).

1. Add one module in `src/signals/`, exporting a `Signal` with a unique `id`.
2. Return `applicable: false` when there is not enough evidence to judge. Give plain-language `reasons` that a site owner can read.
3. Add tests in `test/signals/` covering agent-like, human-like and not-enough-evidence cases, including touch and keyboard input where relevant.
4. Register it in `defaultSignals` in `src/signals/index.ts`.
5. Run `npm test` and `npm run bench`. The benchmark must still pass, with no human session flagged. Commit the updated `bench/results.md`.

To add an agent marker, add the exact selector to `src/signals/markers-list.ts` with a recorded session showing it. Only ids that a named agent adds are accepted.

## Contributing a session

Recorded sessions from people and agents are what make the benchmark meaningful. Sessions from phones, tablets, keyboard-only users and screen reader users are especially welcome.

1. Open the [contribute page](https://ajibadedapo.github.io/browser-agent-guard/contribute.html) and do the short task, by hand or with a browser agent.
2. Stop the recording, describe the session, and review the exact file that would be published. It holds timing, movement and lengths, never typed text.
3. Download the file and submit it with the [Contribute a session](https://github.com/ajibadedapo/browser-agent-guard/issues/new?template=session.yml) issue form.

A maintainer checks the file, adds it to `fixtures/sessions` with `consent: "volunteer"`, lists it in `fixtures/README.md`, and reruns the benchmark.

Maintainers: the issue form applies a `session` label. GitHub only applies labels that exist, so create a `session` label in the repository once.

## Pull requests

Keep changes small and focused. Before opening one, run `npm test`, `npx tsc --noEmit`, `npm run build` and `npm run bench`.
