---
title: 'nuxt prepare'
description: The prepare command creates a .nuxt directory in your application and generates types.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/prepare.ts
    size: xs
---

<!--prepare-cmd-->
```bash [Terminal]
npx nuxt prepare [ROOTDIR] [--cwd=<directory>] [--dotenv=<path>...] [--logLevel=<silent|info|verbose>] [--envName=<environment>] [-e, --extends=<layer-name>...]
```
<!--/prepare-cmd-->

The `prepare` command creates a [`.nuxt`](/docs/directory-structure/nuxt) directory in your application and generates types. This can be useful in a CI environment or as a `postinstall` command in your [`package.json`](/docs/directory-structure/package).

## Arguments

<!--prepare-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/prepare-args-->

## Options

<!--prepare-opts-->
| Option                               | Default | Description                                                                                                                                          |
|--------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--cwd=<directory>`                  |         | Specify the root directory of your Nuxt project                                                                                                      |
| `--dotenv=<path>...`                 |         | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                    |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level                                                                                                                         |
| `--envName=<environment>`            |         | The environment to use when resolving configuration overrides (default is `production` when building, and `development` when running the dev server) |
| `-e, --extends=<layer-name>...`      |         | Extend from a Nuxt layer                                                                                                                             |
<!--/prepare-opts-->

::note
This command sets `process.env.NODE_ENV` to `production`.
::
