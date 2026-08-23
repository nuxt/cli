---
title: "nuxt analyze"
description: "Analyze the production bundle or your Nuxt application."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/analyze.ts
    size: xs
---

<!--analyze-cmd-->
```bash [Terminal]
npx nuxt analyze [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--dotenv=<path>...] [-e, --extends=<layer-name>...] [--name=<name>] [--serve] [--prerender]
```
<!--/analyze-cmd-->

The `analyze` command builds Nuxt and analyzes the production bundle (experimental). The results are served on a local server when the build finishes, unless you pass `--no-serve`.

Routes are not prerendered while analyzing, since prerendering runs the built app and its output is not what is being measured. Pass `--prerender` if your analysis needs it.

## Arguments

<!--analyze-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/analyze-args-->

## Options

<!--analyze-opts-->
| Option                               | Default   | Description                                                                                                       |
|--------------------------------------|-----------|-------------------------------------------------------------------------------------------------------------------|
| `--cwd=<directory>`                  |           | Specify the root directory of your Nuxt project                                                                   |
| `--logLevel=<silent\|info\|verbose>` |           | Specify build-time log level                                                                                      |
| `--dotenv=<path>...`                 |           | Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence. |
| `-e, --extends=<layer-name>...`      |           | Extend from a Nuxt layer                                                                                          |
| `--name=<name>`                      | `default` | Name of the analysis                                                                                              |
| `--serve`                            | `true`    | Serve the analysis results                                                                                        |
| `--no-serve`                         |           | Skip serving the analysis results                                                                                 |
| `--prerender`                        | `false`   | Prerender routes while analyzing                                                                                  |
<!--/analyze-opts-->

::note
This command sets `process.env.NODE_ENV` to `production`.
::
