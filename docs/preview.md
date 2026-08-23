---
title: "nuxt preview"
description: The preview command starts a server to preview your application after the build command.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/preview.ts
    size: xs
---

<!--preview-cmd-->
```bash [Terminal]
npx nuxt preview [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--envName=<environment>] [-e, --extends=<layer-name>...] [-p, --port=<port>] [-h, --host=<host>] [--dotenv=<path>...]
```
<!--/preview-cmd-->

The `preview` command starts a server to preview your Nuxt application after running the `build` command. `nuxt start` is the same command under another name. When running your application in production refer to the [Deployment section](/docs/getting-started/deployment).

Some Nitro presets do not produce a server that can be run locally. For those, the preset's own preview command is run instead, and the command tells you what it is running.

## Arguments

<!--preview-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/preview-args-->

## Options

<!--preview-opts-->
| Option                               | Default | Description                                                                                                                                          |
|--------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--cwd=<directory>`                  |         | Specify the root directory of your Nuxt project                                                                                                      |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level                                                                                                                         |
| `--envName=<environment>`            |         | The environment to use when resolving configuration overrides (default is `production` when building, and `development` when running the dev server) |
| `-e, --extends=<layer-name>...`      |         | Extend from a Nuxt layer                                                                                                                             |
| `-p, --port=<port>`                  |         | Port to listen on (default: `NUXT_PORT \|\| NITRO_PORT \|\| PORT`)                                                                                   |
| `-h, --host=<host>`                  |         | Host to listen on (default: `NUXT_HOST \|\| NITRO_HOST \|\| HOST`)                                                                                   |
| `--dotenv=<path>...`                 |         | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                    |
<!--/preview-opts-->

This command sets `process.env.NODE_ENV` to `production`. To override, define `NODE_ENV` in a `.env` file or as command-line argument.

::note
For convenience, in preview mode, your [`.env`](/docs/directory-structure/env) file will be loaded into `process.env`. (However, in production you will need to ensure your environment variables are set yourself. For example, with Node.js 20+ you could do this by running `NODE_ENV=production node --env-file .env .output/server/index.mjs` to start your server.)
::
