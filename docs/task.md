---
title: "nuxt task"
description: "List and run Nitro tasks on your dev server."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/tree/main/packages/nuxt-cli/src/commands/task
    size: xs
---

The `task` command talks to the [Nitro tasks](https://nitro.build/guide/tasks) your project exposes, using the `nuxt dev` server running for it. Pass `--url` to target another server.

## `nuxt task list`

<!--task-list-cmd-->
```bash [Terminal]
npx nuxt task list [ROOTDIR] [--cwd=<directory>] [--url=<url>] [--json]
```
<!--/task-list-cmd-->

![nuxt task list](/capture/output/nuxt-task-list.svg)

### Arguments

<!--task-list-args-->
| Argument  | Description                                          |
|-----------|------------------------------------------------------|
| `ROOTDIR` | The root directory of your Nuxt project (default: .) |
<!--/task-list-args-->

### Options

<!--task-list-opts-->
| Option              | Default | Description                                                         |
|---------------------|---------|---------------------------------------------------------------------|
| `--cwd=<directory>` |         | Specify the root directory of your Nuxt project                     |
| `--url=<url>`       |         | URL of the Nuxt server to talk to (default: the running dev server) |
| `--json`            |         | Print output as JSON                                                |
<!--/task-list-opts-->

## `nuxt task run`

<!--task-run-cmd-->
```bash [Terminal]
npx nuxt task run <NAME> [ROOTDIR] [--cwd=<directory>] [--url=<url>] [--payload=<json>]
```
<!--/task-run-cmd-->

### Arguments

<!--task-run-args-->
| Argument      | Description                                          |
|---------------|------------------------------------------------------|
| `NAME=<name>` | Name of the task to run                              |
| `ROOTDIR`     | The root directory of your Nuxt project (default: .) |
<!--/task-run-args-->

### Options

<!--task-run-opts-->
| Option              | Default | Description                                                             |
|---------------------|---------|-------------------------------------------------------------------------|
| `--cwd=<directory>` |         | Specify the root directory of your Nuxt project                         |
| `--url=<url>`       |         | URL of the Nuxt server to talk to (default: the running dev server)     |
| `--payload=<json>`  |         | Task payload, either as a JSON object or as `--payload.key=value` pairs |
<!--/task-run-opts-->

The task's result is printed as JSON. A payload can be given as a single JSON object or built up from individual keys:

```bash [Terminal]
npx nuxt task run db:seed --payload '{"count":10}'
npx nuxt task run db:seed --payload.count=10
```

::note
Nitro only scans your `tasks` directory when tasks are enabled, so a server with none exposed may just need this:

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true,
    },
  },
})
```
::

::read-more{to="https://nitro.build/guide/tasks" icon="i-simple-icons-nitro" target="\_blank"}
Read more about Nitro tasks.
::
