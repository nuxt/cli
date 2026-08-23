---
title: "nuxt add-template"
description: "Scaffold an entity into your Nuxt application."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/3.x/packages/nuxi/src/commands/add-template.ts
    size: xs
---

<!--add-template-cmd-->
```bash [Terminal]
npx nuxt add-template <TEMPLATE> <NAME> [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--force]
```
<!--/add-template-cmd-->

::note
`nuxt add <TEMPLATE> <NAME>` still works but is deprecated in favour of `nuxt add-template`.
::

::read-more{to="/docs/api/commands/add"}
Read more about `nuxt add`, which adds Nuxt modules to your application.
::

## Arguments

<!--add-template-args-->
| Argument   | Description                                                                                                                                                                                                      |
|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `TEMPLATE` | Specify which template to generate (options: <api\|app\|app-config\|component\|composable\|error\|layer\|layout\|middleware\|module\|page\|plugin\|server-middleware\|server-plugin\|server-route\|server-util>) |
| `NAME`     | Specify name of the generated file                                                                                                                                                                               |
<!--/add-template-args-->

## Options

<!--add-template-opts-->
| Option                               | Default | Description                              |
|--------------------------------------|---------|------------------------------------------|
| `--cwd=<directory>`                  | `.`     | Specify the working directory            |
| `--logLevel=<silent\|info\|verbose>` |         | Specify build-time log level             |
| `--force`                            | `false` | Force override file if it already exists |
<!--/add-template-opts-->

**Modifiers:**

Some templates support additional modifier flags to add a suffix (like `.client` or `.get`) to their name.

Generated files are written relative to your [`srcDir`](/docs/api/nuxt-config#srcdir), which defaults to the root of your project. The paths below assume that default.

```bash [Terminal]
# Generates `/plugins/sockets.client.ts`
npx nuxt add-template plugin sockets --client
```

## `nuxt add-template component`

* Modifier flags: `--mode client|server` or `--client` or `--server`

```bash [Terminal]
# Generates `components/TheHeader.vue`
npx nuxt add-template component TheHeader
```

## `nuxt add-template composable`

```bash [Terminal]
# Generates `composables/foo.ts`
npx nuxt add-template composable foo
```

## `nuxt add-template layout`

```bash [Terminal]
# Generates `layouts/custom.vue`
npx nuxt add-template layout custom
```

## `nuxt add-template plugin`

* Modifier flags: `--mode client|server` or `--client` or `--server`

```bash [Terminal]
# Generates `plugins/analytics.ts`
npx nuxt add-template plugin analytics
```

## `nuxt add-template page`

```bash [Terminal]
# Generates `pages/about.vue`
npx nuxt add-template page about
```

```bash [Terminal]
# Generates `pages/category/[id].vue`
npx nuxt add-template page "category/[id]"
```

## `nuxt add-template middleware`

* Modifier flags: `--global`

```bash [Terminal]
# Generates `middleware/auth.ts`
npx nuxt add-template middleware auth
```

## `nuxt add-template api`

* Modifier flags: `--method` (can accept `connect`, `delete`, `get`, `head`, `options`, `patch`, `post`, `put` or `trace`) or alternatively you can directly use `--get`, `--post`, etc.

```bash [Terminal]
# Generates `server/api/hello.ts`
npx nuxt add-template api hello
```

## `nuxt add-template layer`

```bash [Terminal]
# Generates `layers/subscribe/nuxt.config.ts`
npx nuxt add-template layer subscribe
```
