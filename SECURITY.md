# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

Useful reports include problems such as:

- a way to make the server check accept a missing, expired, replayed or forged token;
- a way to pass Web Bot Auth verification without the agent's key, or to make the server fetch a URL it should not;
- the browser script recording typed characters, field values or pasted content, or sending data anywhere the site did not configure;
- a crash or excessive resource use caused by a crafted summary or request.

We will acknowledge your report, keep you updated, and credit you if you wish.

## Scope

Detection details are public by design. The signals, thresholds and scoring rules are in the source and in [docs/how-it-works.md](docs/how-it-works.md), so site owners can judge what the library does.

The library is a guard, not a firewall. Someone in full control of their browser can forge evidence that looks human. That is a known limit, described in the README, and not a vulnerability on its own.

Evasion guidance, bypass write-ups and techniques for making an agent look human are not accepted as contributions, as issues or as pull requests. The project documents detection, not how to defeat it. If you find a way past detection, a pull request that adds a new signal or a recorded session of an agent that the benchmark misses is welcome (see [CONTRIBUTING.md](CONTRIBUTING.md)).
