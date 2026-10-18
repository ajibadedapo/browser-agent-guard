# How it works

The guard records how the page is used, runs a set of independent signals over that record, and combines their results into a verdict.

## Recording

The recorder uses passive, capturing listeners on the document and never changes the page. It records:

| Event | What is kept |
| --- | --- |
| `pointermove` | Time, position and pointer type. Only trusted moves. |
| `pointerdown`, `click` | Time, position, pointer type, trust flag, and the position and size of the target. A click with `detail` of 0 is recorded as a keyboard click. |
| `keydown` | Time, trust flag, whether it was a character key, and whether Meta or Ctrl was held. Never which key. Auto-repeat is ignored, and key presses in credential fields are not recorded at all. |
| `input` | Time, trust flag, `inputType`, field kind, and the text length. Never the value. In credential fields, trusted input is not recorded at all, and untrusted input (such as a password manager fill) is recorded with no length and at most once per field per second, so the event count cannot reveal a password length. |
| `paste`, `change` | Time, trust flag and field kind. Never the content. |
| `scroll` | Time and trust flag. |

Field kinds are `text`, `select`, `checkbox`, `credential` and `other`. A field is a `credential` if it is a password or email field (password managers fill both), or its `autocomplete` attribute names an autofill token such as `username`, `email`, `tel`, `street-address`, `address-level2`, `bday`, `organization` or `cc-number`.

When the guard starts it looks for the exact element ids in the known marker list, and counts one only if its parent is `<html>`, `<head>` or `<body>`. After that, a `MutationObserver` counts any element with a known marker id that is added to the page. A marker id on content that was already deeper in the page, such as a heading inside an article, is ignored, and so is any other element added to the page. Each marker element is counted once; a marker that is removed and put back is not counted again.

The environment check reads `navigator.webdriver` and looks for known automation framework globals on `window` and `document`.

The log keeps recent events in a ring buffer. Verdicts and summaries use the most recent 300 events, plus any agent marker still on the page, so a person who hands part of a task to an agent is judged on what happened just before the action.

## Signals

Each signal returns whether it applies, how agent-like the evidence is (0 to 1), a weight, and plain-language reasons. A signal that does not have enough evidence says it does not apply and has no effect.

| Signal | Weight | Applies when | Agent-like when |
| --- | --- | --- | --- |
| `markers` | 3 | An exact known agent marker is on the page | Always (0.99). Names the agent. |
| `environment` | 2 | `navigator.webdriver` is true or an automation trace is found | Always (0.95). |
| `synthetic-input` | 2 | There is an `input`, `paste` or `change` event on a non-credential field | Any of them is untrusted (0.95). If all are trusted but some text appeared with no key press or paste in the 500 ms before, it does not apply. Otherwise human-like (0.05). |
| `typing-rhythm` | 1 | At least 8 character keys, with at least 7 gaps of 1 second or less | Mean gap under 25 ms and standard deviation under 30 ms (0.95). Otherwise human-like (0.1). |
| `pointer-path` | 1 | At least 3 mouse clicks | Median of 2 or fewer mouse moves in the second before each click (0.9), sliding to human-like (0.1) at 10 or more. |
| `click-precision` | 1 | At least 3 mouse clicks on targets with a size | Median offset from the target centre of 5% of the target's diagonal or less (0.9), sliding to human-like (0.1) at 20% or more. |
| `session-rhythm` | 1 | At least 2 bursts of 3 or more actions within 150 ms, each next to an idle gap of over 3 seconds | Always (0.85). Actions are clicks, pastes, and untrusted key, input and change events. |

`synthetic-input` and `session-rhythm` both read untrusted `input` and `change` events, so they share the `synthetic` group. `pointer-path` and `click-precision` both read mouse clicks, so they share the `pointer` group.

Clicks less than 50 ms apart count as one decision.

## Scoring

The scorer only looks at signals that apply:

1. If none apply, the verdict is `unsure` with confidence 0.
2. If `markers` applies, the verdict is `agent`, named after the marker's agent. In block mode there is one exception: if the other signals on their own would give `human`, the verdict is `unsure`, so a planted marker next to clearly human behaviour is not blocked. Detect mode always reports the marker. The server applies the same rule when `verifySubmission` runs in block mode.
3. Otherwise the verdict is `agent` only if at least two independent non-marker signals are agent-like (0.8 or more) and the weighted mean of all applying signals is 0.8 or more. Signals that share a `group` read the same evidence and count once: pointer path and click precision are in the `pointer` group, and synthetic input and session rhythm are in the `synthetic` group. A signal without a group counts on its own.
4. Otherwise, if at least one non-marker signal applies and the weighted mean is 0.35 or less, the verdict is `human`.
5. Otherwise the verdict is `unsure`.

Every verdict carries the reasons from all applying signals.

In the browser, the verdict is `unsure` until there is at least one event other than a marker. Block mode therefore never blocks at page load.

## Rules that protect people

These rules exist so that assistive technology, autofill and ordinary habits are never treated as evidence on their own:

- **No single weak signal.** Without an exact marker, two separate signals must agree. Each signal looks at one kind of evidence.
- **Voice control and switch access.** These often click the centre of an element with no pointer movement first. Pointer path and click precision read the same clicks, so they count as one signal and pointer evidence alone is never enough.
- **Only exact markers.** Browser extensions add elements to pages. Only the exact ids of known agents count.
- **Keyboard clicks.** A click with no pointer behind it (for example Enter or Space on a button) is recorded as a keyboard click. Pointer path and click precision only use mouse clicks.
- **Touch and pen.** Taps never feed pointer path or click precision. A tap is not evidence.
- **Password managers and autofill.** Credential fields, including email fields, are ignored by the synthetic input check, record no length and record no key presses.
- **Scripted form controls.** Custom dropdowns and steppers often send untrusted `input` and `change` events when a person uses them. Synthetic input and session rhythm both read those events, so they count once and cannot make an `agent` verdict together.
- **Autofill and dictation.** Trusted text that appears with no key press is neutral, not agent-like.
- **Pasting.** A trusted paste is human-like. A paste after a keyboard shortcut is noted as such.
- **Real typing in bursts.** Trusted key presses never count as burst actions in session rhythm.

## The summary

When a form is submitted, or `check()` is called, the guard builds a summary: a base64url-encoded JSON object with a version number, the recent events, the environment, and the server token if there is one. It is returned from `check()`, and goes into a hidden field (`bag_summary` by default) only on forms that submit with POST to the page's own origin and match the `forms` selector if you set one. GET forms and forms that post to another origin never get the field and are never blocked, so the evidence does not leave your site.

The summary is not signed. Only the token inside it is. The server re-scores the events itself and never trusts a verdict from the browser. See [server.md](server.md).

## Adding a signal

A signal is an object with an `id` and an `evaluate(events, env)` method that returns a `SignalResult`. Set `group` on the result when the signal reads the same evidence as another, so the two count once toward the two-signal rule. You can pass your own list to `createGuard({ signals })` and `verifySubmission({ signals })`. Use the same list in both places. To add one to the project, see [CONTRIBUTING.md](../CONTRIBUTING.md).
