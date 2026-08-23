---
title: "nuxt build"
description: "Build your Nuxt application."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/build.ts
    size: xs
---

<!--build-cmd-->
```bash [Terminal]
npx nuxt build [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--prerender] [--preset=<nitro-preset>] [--dotenv=<path>...] [--envName=<environment>] [-e, --extends=<layer-name>...] [--profile=<verbose>]
```
<!--/build-cmd-->

The `build` command creates a `.output` directory with all your application, server and dependencies ready for production, and reports how long the build took.

## Arguments

<!--build-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/build-args-->

## Options

<!--build-opts-->
| Option                               | Default | Description                                                                                                                                          |
|--------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--cwd=<directory>`                  |         | Specify the root directory of your Nuxt project                                                                                                      |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level                                                                                                                         |
| `--prerender`                        |         | Build Nuxt and prerender static routes                                                                                                               |
| `--preset=<nitro-preset>`            |         | Nitro server preset (e.g. `node-server`, `vercel`, `netlify`)                                                                                        |
| `--dotenv=<path>...`                 |         | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                    |
| `--envName=<environment>`            |         | The environment to use when resolving configuration overrides (default is `production` when building, and `development` when running the dev server) |
| `-e, --extends=<layer-name>...`      |         | Extend from a Nuxt layer                                                                                                                             |
| `--profile=<verbose>`                |         | Profile performance, writing a V8 CPU profile and a JSON report on exit. Use `--profile=verbose` for a full console report.                          |
<!--/build-opts-->

::note
This command sets `process.env.NODE_ENV` to `production`.
::

::note
`--prerender` will always set the `preset` to `static`
::

When `--preset` is not passed, the `NITRO_PRESET` and `SERVER_PRESET` environment variables are used, in that order.

`--profile` writes a V8 CPU profile to `nuxt-build.cpuprofile` in your project. The build timings it reports, along with `perf-report.json` and `perf-trace.json` in your build directory, come from Nuxt's own build profiling and need Nuxt v4.4 or later.
