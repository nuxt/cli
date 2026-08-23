---
title: "nuxt upgrade"
description: The upgrade command upgrades Nuxt to the latest version.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/upgrade.ts
    size: xs
---

<!--upgrade-cmd-->
```bash [Terminal]
npx nuxt upgrade [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--dedupe] [-f, --force] [-ch, --channel=<stable|nightly|v3|v4|v4-nightly|v3-nightly>]
```
<!--/upgrade-cmd-->

The `upgrade` command upgrades Nuxt to the latest version. It updates the version in your [`package.json`](/docs/directory-structure/package), reinstalls dependencies with your package manager and removes the build cache.

`--channel` picks what to upgrade to: `stable` for the latest release, `v3` or `v4` to stay on a major, and `nightly`, `v3-nightly` or `v4-nightly` for the nightly release channel.

`--force` recreates the lockfile and `node_modules` from scratch, and `--dedupe` deduplicates dependencies afterwards where the package manager supports it.

A dependency pinned to a pnpm catalog (`"nuxt": "catalog:"`) is upgraded in `pnpm-workspace.yaml`, where the version actually lives, rather than in `package.json`.

## Arguments

<!--upgrade-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/upgrade-args-->

## Options

<!--upgrade-opts-->
| Option                                                             | Default  | Description                                         |
|--------------------------------------------------------------------|----------|-----------------------------------------------------|
| `--cwd=<directory>`                                                |          | Specify the root directory of your Nuxt project     |
| `--logLevel=<silent\|info\|verbose>`                               |          | Specify build-time log level                        |
| `--dedupe`                                                         |          | Dedupe dependencies after upgrading                 |
| `-f, --force`                                                      |          | Force upgrade to recreate lockfile and node_modules |
| `-ch, --channel=<stable\|nightly\|v3\|v4\|v4-nightly\|v3-nightly>` | `stable` | Specify a channel to install from                   |
<!--/upgrade-opts-->
