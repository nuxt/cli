# Terminal captures

Records CLI sessions in a pty and renders them as SVGs with light and dark variants selected by `prefers-color-scheme`.

## Recording

Re-record everything:

```bash
node capture/record.ts
```

Re-record one scenario:

```bash
node capture/record.ts --only nuxt-dev-restart
```

The first time you run this, it will copy `capture/fixture/` into a work directory and install its dependencies, which takes a couple of minutes.

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--only <id>` | all | Record one scenario. Repeatable. |
| `--bin <path>` | `packages/nuxt-cli/bin/nuxi.mjs` | The CLI to record. Point this at another build to produce a before/after pair. |
| `--workdir <path>` | `~/.cache/nuxt-cli-capture` | Where the fixture app is materialised. |
| `--out <path>` | `capture/output` | Where SVGs are written. |
| `--columns <n>` | `96` | Terminal width, unless the scenario sets its own. |
| `--no-scrub` | off | Keep real ports, paths and hostnames, and skip the fingerprint gate. |
| `--force` | off | Rewrite SVGs even when the fingerprint says the content is unchanged. |

## Scenarios

Defined in `captures.config.ts`, currently: `nuxt-dev`, `nuxt-dev-static`, `nuxt-dev-restart`, `nuxt-init`, `nuxt-curl`, `nuxt-task-list`, `nuxt-module-search`.

A scenario is a command plus an optional `drive` function that types into the session, edits a file, or waits for a pattern, so flows with several steps can be captured as one animation.

## Scrubbing

Each SVG is scrubbed of ports, LAN addresses, home and temporary directories, and (for dev scenarios) the QR code. Each capture's `<desc>` records which rules were applied.

## Stubbed APIs

`nuxt module search` is recorded against `capture/fixture-data/modules.json` instead of the live `api.nuxt.com`. You can refresh the fixture when the docs should show newer modules.

## Before and after comparisons

Record the same scenario against two builds by pointing `--bin` at each and `--out` at different directories:

```bash
node capture/record.ts --only nuxt-dev --bin /path/to/old/bin/nuxi.mjs --out capture/output/before
node capture/record.ts --only nuxt-dev --out capture/output/after
```

## Requirements

`script` from util-linux, for the pty.
