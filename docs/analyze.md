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
npx nuxt analyze [ROOTDIR] [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--dotenv=<path>...] [-e, --extends=<layer-name>...] [--name=<name>] [--serve] [--prerender] [--json]
```
<!--/analyze-cmd-->

The `analyze` command builds Nuxt and analyzes the production bundle (experimental). The results are served on a local server when the build finishes, unless you pass `--no-serve` or `CI` is set in the environment.

The server links to each report: the client bundle and the Nitro server bundle. When only one report exists, the server shows it directly. The server uses the port in `PORT`, or port 3000. If that port is in use, it picks a free port between 3000 and 3100.

Each run is written to its own directory inside [`analyzeDir`](https://nuxt.com/docs/api/nuxt-config#analyzedir), named after `--name` (`default` when omitted), so you can keep several runs side by side, for example `--name=before` and `--name=after`. Running again with the same name replaces that run only. Characters other than letters, digits, `_` and `-` are replaced with `_` in the directory name, so `--name=after/fix` and `--name=after_fix` share the same directory. If you set `build.analyze.filename`, the client report is written to that path instead.

Pass `--json` to write the reports as JSON instead of HTML: `client.json` and `nitro.json`, in the `raw-data` format of `rollup-plugin-visualizer`. They include each module's size, the chunk it ends up in, and its static and dynamic imports. This makes them easy to process with scripts or AI agents. Nothing is served in this mode.

With Nuxt 5, the Nitro report needs `rollup-plugin-visualizer` in your project. If it's missing, the Nitro report is skipped. With the Vite builder, Nuxt also offers to install it as a dev dependency.

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
| `--json`                             | `false`   | Write the client and server bundle analysis as JSON instead of HTML (implies --no-serve)                          |
<!--/analyze-opts-->

::note
This command sets `process.env.NODE_ENV` to `production`.
::
