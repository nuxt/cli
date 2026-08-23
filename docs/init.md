---
title: "create nuxt"
description: The init command initializes a fresh Nuxt project.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/create-nuxt/src/init.ts
    size: xs
---

<!--init-cmd-->
```bash [Terminal]
npm create nuxt@latest [DIR] -- [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [-t, --template=<template-name>] [-f, --force] [--offline] [--preferOffline] [--install] [--gitInit] [--shell] [--packageManager=<npm|pnpm|yarn|bun|deno|aube|nub>] [-M, --modules=<module-names>] [--nightly=<dist-tag>]
```
<!--/init-cmd-->

The `create-nuxt` command initializes a fresh Nuxt project using [unjs/giget](https://github.com/unjs/giget). It asks which template to start from, whether to install modules, and which package manager to use, then installs dependencies and prints the commands to run next.

![npm create nuxt](/capture/output/nuxt-init.svg)

::note
`nuxt init` was removed from `@nuxt/cli`. Use `npm create nuxt@latest`, or the equivalent for your package manager.
::

## Arguments

<!--init-args-->
| Argument | Description       |
|----------|-------------------|
| `DIR=""` | Project directory |
<!--/init-args-->

## Options

<!--init-opts-->
| Option                                                     | Default | Description                                                                          |
|------------------------------------------------------------|---------|--------------------------------------------------------------------------------------|
| `--cwd=<directory>`                                        | `.`     | Specify the directory to create the project in                                       |
| `--logLevel=<silent\|info\|verbose>`                       |         | Specify build-time log level                                                         |
| `-t, --template=<template-name>`                           |         | Template name                                                                        |
| `-f, --force`                                              |         | Override existing directory                                                          |
| `--offline`                                                |         | Force offline mode                                                                   |
| `--preferOffline`                                          |         | Prefer offline mode                                                                  |
| `--install`                                                | `true`  | Install dependencies once the project has been scaffolded                            |
| `--no-install`                                             |         | Skip installing dependencies                                                         |
| `--gitInit`                                                |         | Initialize git repository                                                            |
| `--no-gitInit`                                             |         | Skip git repository initialization                                                   |
| `--shell`                                                  |         | Start shell after installation in project directory                                  |
| `--packageManager=<npm\|pnpm\|yarn\|bun\|deno\|aube\|nub>` |         | Package manager choice                                                               |
| `-M, --modules=<module-names>`                             |         | Nuxt modules to install (comma separated without spaces)                             |
| `--no-modules`                                             |         | Skip module installation prompt                                                      |
| `--nightly=<dist-tag>`                                     |         | Use Nuxt nightly release channel (a `nuxt-nightly` dist tag, defaulting to `latest`) |
<!--/init-opts-->

## Non-interactive use

Without a terminal to prompt in, the answers it would have asked for have to be passed as arguments: the directory, `--template`, `--packageManager` and `--gitInit`. Anything missing is reported along with the available templates, and the command exits with `2`.

```bash [Terminal]
npm create nuxt@latest my-app -- --template minimal --packageManager pnpm --no-gitInit
```

::note
The `--` is needed with `npm create`, which reads anything flag-shaped after the initializer as npm's own config and warns `Unknown cli config` instead of passing it on. Other package managers forward the whole command line as it is, so pass the flags to them directly: `pnpm create nuxt@latest my-app --template minimal`.
::

## Environment Variables

- `NUXI_INIT_REGISTRY`: Set to a custom template registry. ([learn more](https://github.com/unjs/giget#custom-registry)).
  - Default registry is loaded from [nuxt/starter/templates](https://github.com/nuxt/starter/tree/templates/templates)
