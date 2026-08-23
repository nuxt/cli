---
title: 'nuxt cleanup'
description: 'Remove common generated Nuxt files and caches.'
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/cleanup.ts
    size: xs
---

<!--cleanup-cmd-->
```bash [Terminal]
npx nuxt cleanup [ROOTDIR] [--cwd=<directory>]
```
<!--/cleanup-cmd-->

The `cleanup` command removes common generated Nuxt files and caches, including:

- your build directory, which is `.nuxt` unless [`buildDir`](/docs/api/nuxt-config#builddir) says otherwise
- `.output`
- `dist`
- `node_modules/.vite`
- `node_modules/.cache`

## Arguments

<!--cleanup-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/cleanup-args-->

## Options

<!--cleanup-opts-->
| Option              | Default | Description                                     |
|---------------------|---------|-------------------------------------------------|
| `--cwd=<directory>` |         | Specify the root directory of your Nuxt project |
<!--/cleanup-opts-->
