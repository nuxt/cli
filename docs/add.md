---
title: "nuxt add"
description: "Add Nuxt modules and layers to your application."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/add.ts
    size: xs
---

<!--add-cmd-->
```bash [Terminal]
npx nuxt add <MODULENAME...> [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--skipInstall] [--skipConfig] [--dev] [--packageManager=<npm|pnpm|yarn|bun|deno|aube|nub>]
```
<!--/add-cmd-->

The `add` command installs [Nuxt modules](/modules) and [layers](/docs/getting-started/layers) into your application. It is the same command as [`nuxt module add`](/docs/api/commands/module#nuxt-module-add), with layers included.

## Arguments

<!--add-args-->
| Argument        | Description                                                                   |
|-----------------|-------------------------------------------------------------------------------|
| `MODULENAME...` | Specify one or more modules or layers to install by name, separated by spaces |
<!--/add-args-->

## Options

<!--add-opts-->
| Option                                                     | Default | Description                                     |
|------------------------------------------------------------|---------|-------------------------------------------------|
| `--cwd=<directory>`                                        | `.`     | Specify the root directory of your Nuxt project |
| `--logLevel=<silent\|info\|verbose>`                       |         | Specify build-time log level                    |
| `--skipInstall`                                            |         | Skip npm install                                |
| `--skipConfig`                                             |         | Skip nuxt.config.ts update                      |
| `--dev`                                                    |         | Install modules as dev dependencies             |
| `--packageManager=<npm\|pnpm\|yarn\|bun\|deno\|aube\|nub>` |         | Package manager to install with                 |
<!--/add-opts-->

When running the command, it will:

- install the package as a dependency using your package manager, unless you pass `--skipInstall`
- add it to your [`package.json`](/docs/directory-structure/package) file
- register it in your [`nuxt.config`](/docs/directory-structure/nuxt-config) file, in `modules` for a module and in `extends` for a layer, unless you pass `--skipConfig`

**Example:**

```bash [Terminal]
npx nuxt add pinia
```

Several packages can be added at once, and the modules will be resolved against the Nuxt version your project uses:

```bash [Terminal]
npx nuxt add @nuxt/image @nuxt/fonts
```

Run it without a name to browse the available modules interactively.

::note
`nuxt add <template> <name>` is deprecated. Use [`nuxt add-template`](/docs/api/commands/add-template) to scaffold files.
::

::read-more{to="/docs/api/commands/module"}
Read more about searching for and removing modules.
::
