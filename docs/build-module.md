---
title: 'nuxt build-module'
description: 'Nuxt command to build your Nuxt module before publishing.'
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/module-builder/blob/main/src/cli.ts
    size: xs
---

<!--build-module-cmd-->
```bash [Terminal]
npx nuxt build-module build [ROOTDIR] [--cwd=<directory>] [--outDir=<directory>] [--sourcemap] [--stub]
npx nuxt build-module prepare [ROOTDIR] [--cwd=<directory>]
```
<!--/build-module-cmd-->

The `build-module` command runs `@nuxt/module-builder` to generate `dist` directory within your `rootDir` that contains the full build for your **nuxt-module**.

## Arguments

<!--build-module-args-->
| Argument      | Description                                    |
|---------------|------------------------------------------------|
| `ROOTDIR="."` | Specifies the working directory (default: `.`) |
<!--/build-module-args-->

## Options

<!--build-module-opts-->
### `build`

| Option                 | Default | Description                                                                      |
|------------------------|---------|----------------------------------------------------------------------------------|
| `--cwd=<directory>`    |         | Specify the working directory, this takes precedence over ROOTDIR (default: `.`) |
| `--outDir=<directory>` | `dist`  | Build directory                                                                  |
| `--sourcemap`          | `false` | Generate sourcemaps                                                              |
| `--stub`               | `false` | Stub dist instead of actually building it for development                        |

### `prepare`

| Option              | Default | Description                                                                      |
|---------------------|---------|----------------------------------------------------------------------------------|
| `--cwd=<directory>` |         | Specify the working directory, this takes precedence over ROOTDIR (default: `.`) |
<!--/build-module-opts-->

`--stub` skips the full build and writes a `dist` directory whose files re-export your module's source, so a consuming project sees changes without a rebuild. Read more about [stub builds](/docs/guide/modules/module-builder/commands#build-stub).

Run `nuxt build-module prepare` to generate the `.nuxt` directory and module types you need while developing the module. Read more about [preparing a module](/docs/guide/modules/module-builder/commands#prepare).

::read-more{to="/docs/guide/modules/module-builder"}
Read more about `@nuxt/module-builder`.
::
