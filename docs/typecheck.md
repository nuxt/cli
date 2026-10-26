---
title: "nuxt typecheck"
description: The typecheck command runs vue-tsc or Golar to check types throughout your app.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/typecheck.ts
    size: xs
---

<!--typecheck-cmd-->
```bash [Terminal]
npx nuxt typecheck [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--dotenv=<path>...] [-e, --extends=<layer-name>...] [--checker=<vue-tsc|golar>] [-b, --build] [--per-project]
```
<!--/typecheck-cmd-->

The `typecheck` command runs [`vue-tsc`](https://github.com/vuejs/language-tools/tree/master/packages/tsc) or [Golar](https://golar.dev/languages/vue/) to check types throughout your app. If neither is installed you are offered the install command for your package manager.

## Arguments

<!--typecheck-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/typecheck-args-->

## Options

<!--typecheck-opts-->
| Option                               | Default | Description                                                                                                       |
|--------------------------------------|---------|-------------------------------------------------------------------------------------------------------------------|
| `--cwd=<directory>`                  |         | Specify the root directory of your Nuxt project                                                                   |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level                                                                                      |
| `--dotenv=<path>...`                 |         | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence. |
| `-e, --extends=<layer-name>...`      |         | Extend from a Nuxt layer                                                                                          |
| `--checker=<vue-tsc\|golar>`         |         | Type checker to use                                                                                               |
| `-b, --build`                        |         | Type-check in build mode, using TypeScript project references (detected automatically by default)                 |
| `--no-build`                         |         | Type-check without TypeScript project references                                                                  |
| `--per-project`                      |         | Type-check each project reference in its own process, one after another, to lower peak memory usage               |
<!--/typecheck-opts-->

## Type checkers

`--checker golar` runs [Golar](https://golar.dev/languages/vue/) instead of `vue-tsc`, and a `golar.config.*` file in your project makes it the default. A config file is written for you if one is missing.

## Build mode

A solution-style `tsconfig.json` (one that only lists `references`) is type-checked in build mode automatically. `--build` forces it, and `--no-build` turns it off.

Build mode checks every project reference in a single process, which holds on to the memory of each project until the end. On machines with little memory, `--per-project` checks each reference in its own process instead (`vue-tsc -p <reference> --noEmit`, or `golar tsc -p <reference> --noEmit`), one after another, so peak memory stays at that of the largest project. It keeps going after a failing project, so one run reports every error. Without memory pressure this is usually a little slower, as types shared between projects are loaded once per process. It is meant for Nuxt's generated project configs: if a referenced project has `references` of its own, those are not built first.

::note
This command sets `process.env.NODE_ENV` to `production`. To override, define `NODE_ENV` in a [`.env`](/docs/directory-structure/env) file or as a command-line argument.
::

::read-more{to="/docs/guide/concepts/typescript#type-checking"}
Read more on how to enable type-checking at build or development time.
::
