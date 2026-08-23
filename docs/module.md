---
title: "nuxt module"
description: "Search, add and remove modules in your Nuxt application with the command line."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/tree/main/packages/nuxt-cli/src/commands/module
    size: xs
---

Nuxt provides a few utilities to work with [Nuxt modules](/modules) seamlessly.

## `nuxt module add`

<!--module-add-cmd-->
```bash [Terminal]
npx nuxt module add <MODULENAME...> [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--skipInstall] [--skipConfig] [--dev] [--packageManager=<npm|pnpm|yarn|bun|deno|aube|nub>]
```
<!--/module-add-cmd-->

### Arguments

<!--module-add-args-->
| Argument        | Description                                                         |
|-----------------|---------------------------------------------------------------------|
| `MODULENAME...` | Specify one or more modules to install by name, separated by spaces |
<!--/module-add-args-->

### Options

<!--module-add-opts-->
| Option                                                     | Default | Description                                     |
|------------------------------------------------------------|---------|-------------------------------------------------|
| `--cwd=<directory>`                                        | `.`     | Specify the root directory of your Nuxt project |
| `--logLevel=<silent\|info\|verbose>`                       |         | Specify build-time log level                    |
| `--skipInstall`                                            |         | Skip npm install                                |
| `--skipConfig`                                             |         | Skip nuxt.config.ts update                      |
| `--dev`                                                    |         | Install modules as dev dependencies             |
| `--packageManager=<npm\|pnpm\|yarn\|bun\|deno\|aube\|nub>` |         | Package manager to install with                 |
<!--/module-add-opts-->

The command lets you install [Nuxt modules](/modules) in your application with no manual work.

When running the command, it will:

- install the module as a dependency using your package manager
- add it to your [package.json](/docs/directory-structure/package) file
- update your [`nuxt.config`](/docs/directory-structure/nuxt-config) file

**Example:**

Installing the [`Pinia`](/modules/pinia) module

```bash [Terminal]
npx nuxt module add pinia
```

Run it without a module name to pick from the modules compatible with your Nuxt version.

::note
[`nuxt add`](/docs/api/commands/add) is the same command, and also accepts layers.
::

## `nuxt module remove`

<!--module-remove-cmd-->
```bash [Terminal]
npx nuxt module remove [MODULENAME...] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--skipInstall] [--skipConfig]
```
<!--/module-remove-cmd-->

### Arguments

<!--module-remove-args-->
| Argument        | Description                                                        |
|-----------------|--------------------------------------------------------------------|
| `MODULENAME...` | Specify one or more modules to remove by name, separated by spaces |
<!--/module-remove-args-->

### Options

<!--module-remove-opts-->
| Option                               | Default | Description                                     |
|--------------------------------------|---------|-------------------------------------------------|
| `--cwd=<directory>`                  | `.`     | Specify the root directory of your Nuxt project |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level                    |
| `--skipInstall`                      |         | Skip dependency uninstall                       |
| `--skipConfig`                       |         | Skip nuxt.config.ts update                      |
<!--/module-remove-opts-->

The command uninstalls the package and removes it from the `modules` array in your [`nuxt.config`](/docs/directory-structure/nuxt-config).

**Example:**

```bash [Terminal]
npx nuxt module remove pinia
```

Run it without a module name to pick from the modules the project currently uses.

## `nuxt module search`

<!--module-search-cmd-->
```bash [Terminal]
npx nuxt module search <QUERY> [--cwd=<directory>] [--nuxtVersion=<3|4|4.2.0>] [--json]
```
<!--/module-search-cmd-->

![nuxt module search](/capture/output/nuxt-module-search.svg)

### Arguments

<!--module-search-args-->
| Argument | Description            |
|----------|------------------------|
| `QUERY`  | keywords to search for |
<!--/module-search-args-->

### Options

<!--module-search-opts-->
| Option                        | Default | Description                                                                        |
|-------------------------------|---------|------------------------------------------------------------------------------------|
| `--cwd=<directory>`           | `.`     | Specify the root directory of your Nuxt project                                    |
| `--nuxtVersion=<3\|4\|4.2.0>` |         | Filter by Nuxt version and list compatible modules only (auto detected by default) |
| `--json`                      |         | Print output as JSON                                                               |
<!--/module-search-opts-->

The command searches for Nuxt modules matching your query that are compatible with your Nuxt version, showing each module's description with the matched text highlighted.

**Example:**

```bash [Terminal]
npx nuxt module search pinia
```

Use `--json` to get the results as machine-readable JSON.
