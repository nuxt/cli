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
npx nuxt typecheck [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--dotenv=<path>...] [-e, --extends=<layer-name>...] [--checker=<vue-tsc|golar>] [-b, --build] [--incremental]
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
| `--incremental`                      | `true`  | Reuse type information from previous runs                                                                         |
| `--no-incremental`                   |         | Type-check from scratch, without reusing type information from previous runs                                      |
<!--/typecheck-opts-->

## Type checkers

`--checker golar` runs [Golar](https://golar.dev/languages/vue/) instead of `vue-tsc`, and a `golar.config.*` file in your project makes it the default. A config file is written for you if one is missing.

## Build mode

A solution-style `tsconfig.json` (one that only lists `references`) is type-checked in build mode automatically. `--build` forces it, and `--no-build` turns it off.

## Incremental type-checking

In build mode, type information from each run is stored in the `tsBuildInfoFile` of every project referenced by `tsconfig.json`, so later runs only re-check what changed. From Nuxt v4.7, Nuxt's generated project configs store it in `.nuxt/cache/typecheck`, which is kept by `nuxt prepare` and `nuxt dev`. The cache is discarded when the type checker or TypeScript version changes, and is not used if any referenced project has no `tsBuildInfoFile`. Pass `--no-incremental` to remove the cached type information and type-check from scratch.

## Memory

The type checker runs in its own process. Unless you set `--max-old-space-size`, the heap limit of `vue-tsc` is raised to half of the memory of your machine (or of the container it runs in), up to 8 GB and at most the memory currently available. It is never set lower than Node's default. Golar type-checks outside of the JavaScript heap, so its limit is left alone.

If the type checker is killed, for example because it ran out of memory, `nuxt typecheck` reports the signal and exits with `128` plus the signal number (`134` for `SIGABRT`, `137` for `SIGKILL`). To raise the heap limit yourself:

```bash [Terminal]
NODE_OPTIONS=--max-old-space-size=8192 npx nuxt typecheck
```

::note
This command sets `process.env.NODE_ENV` to `production`. To override, define `NODE_ENV` in a [`.env`](/docs/directory-structure/env) file or as a command-line argument.
::

::read-more{to="/docs/guide/concepts/typescript#type-checking"}
Read more on how to enable type-checking at build or development time.
::
