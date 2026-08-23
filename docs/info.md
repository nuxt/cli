---
title: "nuxt info"
description: The info command logs information about the current or specified Nuxt project.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/info.ts
    size: xs
---

<!--info-cmd-->
```bash [Terminal]
npx nuxt info [ROOTDIR] [--cwd=<directory>] [--json]
```
<!--/info-cmd-->

The `info` command logs information about the current or specified Nuxt project: the versions of Nuxt, Nitro and Vite it resolves, the package manager, the modules it loads and the build modules in its configuration. Use `--json` when you want to read it from a script.

## Arguments

<!--info-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/info-args-->

## Options

<!--info-opts-->
| Option              | Default | Description                                     |
|---------------------|---------|-------------------------------------------------|
| `--cwd=<directory>` |         | Specify the root directory of your Nuxt project |
| `--json`            |         | Print project info as JSON                      |
<!--/info-opts-->
