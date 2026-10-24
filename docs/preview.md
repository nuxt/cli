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
npx nuxt preview [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--envName=<environment>] [-e, --extends=<layer-name>...] [-p, --port=<port>] [-h, --host=<host>] [--takeover] [--strictPort] [--dotenv=<path>...]
```
<!--/preview-cmd-->

The `preview` command starts a server to preview your Nuxt application after running the `build` command. `nuxt start` is the same command under another name. When running your application in production refer to the [Deployment section](/docs/getting-started/deployment).

When the configured `server.builder` produces no server at all (a client-only build, for example), there is nothing to run: the static output is served directly instead, with unmatched paths falling back to the client entry so client-side routing works.

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
| `--takeover`                         |         | Stop a preview server already running on this project and take its place                                                                             |
| `--no-takeover`                      |         | Never stop a preview server already running on this project                                                                                          |
| `--strictPort`                       | `false` | Exit if the requested port is unavailable instead of using another one                                                                               |
| `--dotenv=<path>...`                 |         | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                    |
<!--/preview-opts-->

## Taking over a running preview

A preview records itself in `node_modules/.cache/nuxt/preview`, so a second `nuxt preview` for the same project deals with the one already running the way [`nuxt dev`](/docs/api/commands/dev#taking-over-a-running-dev-server) deals with a running dev server:

| Running preview was started | New preview is started | What happens |
|-----------------------------|------------------------|--------------|
| without a terminal | without a terminal | It is stopped, and the new one takes its port. |
| without a terminal | in a terminal | You are asked, defaulting to taking it over. |
| in a terminal | without a terminal | The new one exits, saying where the running one is. |
| in a terminal | in a terminal | You are asked, defaulting to not starting. |

Pass `--takeover` to always stop it and start in its place, or `--no-takeover` to never do so. Choosing "Start anyway" at the prompt, or passing a different `--port`, runs a second preview alongside it instead.

When another server, including `nuxt dev`, is using the requested port, the preview automatically uses another free port without stopping that server. Pass `--strictPort` to exit instead. The requested port comes from `--port`, `NUXT_PORT`, `NITRO_PORT`, or `PORT`, defaulting to `3000`.

Port selection applies to static previews and preview commands that run directly with Node.js, Bun, or Deno. Other preview commands choose their own port.

This command sets `process.env.NODE_ENV` to `production`. To override, define `NODE_ENV` in a `.env` file or as command-line argument.

::note
For convenience, in preview mode, your [`.env`](/docs/directory-structure/env) file will be loaded into `process.env`. (However, in production you will need to ensure your environment variables are set yourself. For example, with Node.js 20+ you could do this by running `NODE_ENV=production node --env-file .env .output/server/index.mjs` to start your server.)
::
