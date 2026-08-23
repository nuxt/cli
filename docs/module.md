---
title: "nuxt module"
description: "Search and remove modules in your Nuxt application with the command line."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/tree/3.x/packages/nuxi/src/commands/module
    size: xs
---

Nuxt provides a few utilities to work with [Nuxt modules](/modules) seamlessly.

::read-more{to="/docs/api/commands/add"}
Read more about `nuxt add`, which installs modules into your application.
::

## `nuxt module remove`

<!--module-remove-cmd-->
```bash [Terminal]
npx nuxt module remove [MODULENAME] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--skipInstall] [--skipConfig]
```
<!--/module-remove-cmd-->

### Arguments

<!--module-remove-args-->
| Argument     | Description                                                        |
|--------------|--------------------------------------------------------------------|
| `MODULENAME` | Specify one or more modules to remove by name, separated by spaces |
<!--/module-remove-args-->

### Options

<!--module-remove-opts-->
| Option                               | Default | Description                    |
|--------------------------------------|---------|--------------------------------|
| `--cwd=<directory>`                  | `.`     | Specify the working directory  |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level   |
| `--skipInstall`                      |         | Skip dependency uninstall      |
| `--skipConfig`                       |         | Skip nuxt.config.ts update     |
<!--/module-remove-opts-->

The command uninstalls the module (unless `--skipInstall` is set) and removes it from your [`nuxt.config`](/docs/directory-structure/nuxt-config) file (unless `--skipConfig` is set). If no module name is passed, you will be prompted to select from the modules registered in your `nuxt.config`. A module name is required when `--skipConfig` is set.

**Example:**

```bash [Terminal]
npx nuxt module remove pinia
```

## `nuxt module search`

<!--module-search-cmd-->
```bash [Terminal]
npx nuxt module search <QUERY> [--cwd=<directory>] [--nuxtVersion=<2|3>]
```
<!--/module-search-cmd-->

### Arguments

<!--module-search-args-->
| Argument | Description            |
|----------|------------------------|
| `QUERY`  | keywords to search for |
<!--/module-search-args-->

### Options

<!--module-search-opts-->
| Option                 | Default | Description                                                                        |
|------------------------|---------|------------------------------------------------------------------------------------|
| `--cwd=<directory>`    | `.`     | Specify the working directory                                                      |
| `--nuxtVersion=<2\|3>` |         | Filter by Nuxt version and list compatible modules only (auto detected by default) |
<!--/module-search-opts-->

The command searches for Nuxt modules matching your query that are compatible with your Nuxt version.

**Example:**

```bash [Terminal]
npx nuxt module search pinia
```
