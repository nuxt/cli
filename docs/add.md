---
title: "nuxt add"
description: "Add modules to your Nuxt application with the command line."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/3.x/packages/nuxi/src/commands/module/add.ts
    size: xs
---

<!--add-cmd-->
```bash [Terminal]
npx nuxt add <MODULENAME> [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--skipInstall] [--skipConfig] [--dev]
```
<!--/add-cmd-->

## Arguments

<!--add-args-->
| Argument     | Description                                                         |
|--------------|---------------------------------------------------------------------|
| `MODULENAME` | Specify one or more modules to install by name, separated by spaces |
<!--/add-args-->

## Options

<!--add-opts-->
| Option                               | Default | Description                         |
|--------------------------------------|---------|-------------------------------------|
| `--cwd=<directory>`                  | `.`     | Specify the working directory       |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level        |
| `--skipInstall`                      |         | Skip npm install                    |
| `--skipConfig`                       |         | Skip nuxt.config.ts update          |
| `--dev`                              |         | Install modules as dev dependencies |
<!--/add-opts-->

The command lets you install [Nuxt modules](/modules) in your application with no manual work.

When running the command, it will:

- install the module as a dependency using your package manager (unless `--skipInstall` is set)
- add it to your [package.json](/docs/directory-structure/package) file (unless `--skipInstall` is set)
- update your [`nuxt.config`](/docs/directory-structure/nuxt-config) file (unless `--skipConfig` is set)

If no module name is passed, you will be prompted to search for and select modules to add.

**Example:**

Installing the [`Pinia`](/modules/pinia) module

```bash [Terminal]
npx nuxt add pinia
```

::note
`nuxt module add` is an alias for `nuxt add`.
::

::read-more{to="/docs/api/commands/module"}
Read more about the other `nuxt module` commands.
::
